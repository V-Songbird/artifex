// Pen and pencil: a sepia ballpoint and a tin of coloured pencils on a
// sheet of paper that was folded and smoothed out again. The pen line
// thickens where the hand pressed, skips where it moved fast and pools where
// it paused; a pencil fill is hatched strokes broken by the paper's tooth,
// overshooting the outline a little; characters are round, with big eyes and
// blushed cheeks, and the lettering is the same pen, one letter at a time.
//
// A parts bin: functions that draw the style's marks on any path,
// outline or area you give them. Nothing here picks a subject, a scene or a
// layout.

'use strict';

const { noise2, fbm } = require('../../../core/rand.js');
const { resample, pointInPoly, bbox, chaikin } =require('../../../core/geom.js');
const { outline } = require('../../../core/path.js');
const font = require('../../../core/stroke-font.js');
const { path, wobble, ellipse, bristles, grain } = require('./kit.js');

// The cream sheet, the three ballpoint inks as rgb triples, and the pencil tin.
const PAPER = '#ece6d9';
const INK = { brown: [70, 46, 30], blue: [40, 58, 150], red: [186, 46, 50] };
const PENCIL = {
  green: '#5c9a48', red: '#d8504a', orange: '#ea9552', yellow: '#e9c23c', blue: '#4f73c8',
  sky: '#7fa6d8', pink: '#e89aae', brown: '#9c6c46', grey: '#8d8880', lilac: '#8f7fc6', cream: '#f2d9a0',
};
// An rgb triple at alpha `a`, clamped to 0..1, as a CSS colour.
const rgba = (c, a) => 'rgba(' + c.join(', ') + ', ' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// One device pixel in the sheet's units, read from the surface's transform
// (the vector surface has one too), or one unit on a surface with none.
function hairline(g) {
  if (typeof g.getTransform !== 'function') return 1;
  const m = g.getTransform();
  return 1 / (Math.hypot(m.a, m.b) || 1);
}

// One ballpoint line along `pts`. The hand's wobble (`wob`), then the
// pressure along it: `w` is the width at full pressure, and the line swells
// and fades between a third of it and all of it, a little heavier at each
// corner, thin where it starts. Where the ball ran fast it skips (`skip`, the
// share of the line left bare), and each run of ink is one filled outline at
// `tone` that tapers into and out of the skip, so the width changes without
// beads and keeps its full width round a sharp turn. Ink pools only where the ball was set down, paused at a sharp corner
// or, now and then, lifted. `ink` names an `INK` or is an rgb triple. No run
// is thinner than one device pixel except over the two points where it
// tapers into a skip, so the sheet still reads when it is drawn small.
function pen(g, R, name, pts, opts = {}) {
  const { ink = 'brown', w = 2, close = false, tone = 0.78, skip = 0.1, wob = 1.1 } = opts;
  const spine = resample(wobble(pts, R, name, wob, 5, close), 2.5);
  const n = spine.length;
  if (n < 2) return;
  const c = Array.isArray(ink) ? ink : INK[ink];
  const fl = hairline(g) / 2;
  const half = new Array(n); const on = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = spine[Math.max(0, i - 1)]; const b = spine[Math.min(n - 1, i + 1)]; const p = spine[i];
    const d = Math.abs(Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0]));
    const turn = Math.min(1, (d > Math.PI ? Math.PI * 2 - d : d) / 1.3);
    const drift = 0.35 + 0.65 * fbm(R, i * 0.045, 0.3, 2, name + 'p');
    const ends = (0.5 + 0.5 * Math.min(1, t * 7)) * (0.7 + 0.3 * Math.min(1, (1 - t) * 7));
    half[i] = Math.max(fl, (w / 2) * drift * ends * (1 + 0.25 * turn));
    on[i] = noise2(R, i * 0.17, 4.4, name + 's') > skip;
  }
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const pool = (i, k, a) => {
    g.fillStyle = rgba(c, a);
    g.beginPath();
    g.arc(spine[i][0], spine[i][1], half[i] * k, 0, Math.PI * 2);
    g.fill();
  };
  for (let i = 0; i < n;) {
    if (!on[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && on[j + 1]) j++;
    if (j > i) {
      const run = spine.slice(i, j + 1);
      // Into and out of a skip the ball loses the paper over two points.
      const taper = (k) => Math.min(1, i > 0 ? (k + 0.5) / 2.5 : 1, j < n - 1 ? (j - i - k + 0.5) / 2.5 : 1);
      g.fillStyle = rgba(c, tone);
      path(g, outline(run, run.map((_, k) => 2 * half[i + k] * taper(k)), { cap: 'butt' }));
      g.fill();
      // The darker thread down the middle of a ballpoint line.
      g.strokeStyle = rgba(c, tone * 0.3);
      g.lineWidth = w * 0.3;
      path(g, run, false);
      g.stroke();
    }
    i = j + 1;
  }
  // The ball set down, each pause at a sharp corner, and sometimes the lift.
  if (R(name, 'set') < 0.6) pool(0, 1.3, tone);
  for (let i = 2; i < n - 2; i++) {
    const a = spine[i - 2]; const b = spine[i + 2]; const p = spine[i];
    const d = Math.abs(Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0]));
    if ((d > Math.PI ? Math.PI * 2 - d : d) > 1.1) pool(i, 1.2, tone);
  }
  if (R(name, 'lift') < 0.35) pool(n - 1, 1.3, tone);
  g.restore();
}

// A dot of ink of radius `r`: a pupil, a nostril, a full stop.
function dot(g, x, y, r, ink = 'brown', tone = 0.95) {
  g.fillStyle = rgba(Array.isArray(ink) ? ink : INK[ink], tone);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// The paper's tooth at (x, y), 0 to 1: one field for the whole sheet, so
// every pencil stroke breaks on the same peaks.
const tooth = (R, x, y) => noise2(R, x / 2.3, y / 2.3, 'tooth');

// One short piece of a pencil stroke, from (px, py) to (x, y) at strength `t`:
// its weight and width follow the tooth, and it is left out where a peak of
// the paper took no pigment (the tooth at or under `bare`). Pieces of one
// weight and width are kept together in `batches`, for `lay`.
function piece(batches, R, px, py, x, y, t, bare = 0.3) {
  const th = tooth(R, x, y);
  if (th <= bare) return;
  const al = Math.round(Math.max(0, Math.min(1, t * (0.35 + 0.65 * th))) * 64);
  const wd = Math.round((0.7 + 0.5 * th) * 10);
  const key = al * 32 + wd;
  let b = batches.get(key);
  if (!b) batches.set(key, b = { al, wd, at: [] });
  b.at.push(px, py, x, y);
}

// Strokes the pieces in `batches` in the rgb `c`, `w` wide at full width and
// never under `fl`: one path per weight and width.
function lay(g, batches, c, w, fl) {
  for (const b of batches.values()) {
    if (!b.al) continue;
    g.strokeStyle = rgba(c, b.al / 64);
    g.lineWidth = Math.max(fl, (w * b.wd) / 10);
    g.beginPath();
    for (let i = 0; i < b.at.length; i += 4) {
      g.moveTo(b.at[i], b.at[i + 1]);
      g.lineTo(b.at[i + 2], b.at[i + 3]);
    }
    g.stroke();
  }
}

// A coloured-pencil fill of `region` in a hex `colour`: parallel strokes at
// `angle`, `spacing` apart, each one overshooting the outline by up to
// `over`, drawn in short pieces `w` wide whose weight follows the tooth, and
// absent where a peak of the paper took no pigment. `tone` is the strength
// (keep it under 0.6), `cross` adds a second pass turned 0.55. `within` keeps
// the strokes inside a second outline too, for a shade on a body that must
// not spill past it.
function pencil(g, R, name, region, colour, opts = {}) {
  const { angle = -0.95, spacing = 3.3, w = 2.1, tone = 0.5, over = 5, cross = false, within = null } = opts;
  const [x0, y0, x1, y1] = bbox(region);
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const r = Math.hypot(x1 - x0, y1 - y0) / 2 + over + 2;
  const c = hexRgb(colour);
  const fl = hairline(g);
  g.save();
  g.lineCap = 'round';
  const pass = (a, k0, t) => {
    const ux = Math.cos(a); const uy = Math.sin(a);
    // Pieces of one weight and width are stroked as one path: a fill is tens
    // of thousands of pieces, and a stroke call each was most of its cost.
    // The weight is kept to 1/64 and the width to a tenth of `w`.
    const batches = new Map();
    let k = 0;
    for (let d = -r; d <= r; d += spacing * (0.8 + 0.4 * R(name, 'gap', k0 + k)), k++) {
      const ox = cx - uy * d; const oy = cy + ux * d;
      const m = Math.ceil(r); const inside = [];
      for (let s = -m; s <= m; s += 2) {
        const p = [ox + ux * s, oy + uy * s];
        inside.push(pointInPoly(p, region) && (!within || pointInPoly(p, within)));
      }
      let s = 0;
      while (s < inside.length) {
        if (!inside[s]) { s++; continue; }
        let e = s;
        while (e + 1 < inside.length && inside[e + 1]) e++;
        const from = -m + s * 2 - over * R(name, 'o0', k0 + k * 7 + s); const to = -m + e * 2 + over * R(name, 'o1', k0 + k * 7 + e);
        const press = 0.7 + 0.6 * R(name, 'w', k0 + k * 7 + s);
        let px = null; let py = null;
        for (let q = from; q <= to + 1; q += 2) {
          const u = Math.min(q, to);
          const x = ox + ux * u + (noise2(R, u * 0.08, k, name + 'j') - 0.5) * 1.4; const y = oy + uy * u + (noise2(R, u * 0.08, k + 50, name + 'j') - 0.5) * 1.4;
          if (px !== null) piece(batches, R, px, py, x, y, t * press);
          px = x; py = y;
          if (u === to) break;
        }
        s = e + 1;
      }
    }
    lay(g, batches, c, w, fl);
  };
  pass(angle, 0, tone);
  if (cross) pass(angle + 0.55, 1000, tone * 0.6);
  g.restore();
}

// One pencil stroke dragged along `pts` in a hex `colour`, `width` (4) wide:
// the lead's grain as `count` hairs from kit's `bristles`, breaking where the
// paper's `tooth` takes no pigment, more toward the stroke's edges and its
// lift, by `dry` (0.6; 0 a solid band, 1 a lead that gives out before the
// end). `tone` (0.5) is the strength, kept under 0.6 as for a fill. The
// stroke presses in and eases off over its length.
function drag(g, R, name, pts, colour, opts = {}) {
  const { width = 4, tone = 0.5, dry = 0.6, count = Math.max(4, Math.round(width * 1.5)) } = opts;
  const c = hexRgb(colour);
  const fl = hairline(g);
  const press = (t) => 0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, 0.15 + t));
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  bristles(R, name, pts, { width, count, press, dry, dryFrom: 0, streak: 8, tooth: (x, y) => tooth(R, x, y) }).forEach((hair, j) => {
    g.strokeStyle = rgba(c, tone * (0.6 + 0.4 * R(name, 'load', j)));
    g.lineWidth = Math.max(fl, hair.w);
    g.beginPath();
    for (const run of hair.runs) {
      g.moveTo(run[0][0], run[0][1]);
      for (let i = 1; i < run.length; i++) g.lineTo(run[i][0], run[i][1]);
    }
    g.stroke();
  });
  g.restore();
}

// The way an outline runs longest, as an angle: the axis its points spread
// most along.
function longAxis(region) {
  const pts = resample(region, 6, true);
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length; const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let xx = 0; let yy = 0; let xy = 0;
  for (const [x, y] of pts) { xx += (x - mx) * (x - mx); yy += (y - my) * (y - my); xy += (x - mx) * (y - my); }
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}

// A loose scribble fill of `region` in a hex `colour`: the lead laid in one
// zigzag that travels along the form and swings across it, each swing turning
// at the outline, so the scribble takes the form's shape and leaves half of it
// or more bare. The line travels along `angle` (by default the form's long
// axis), a swing every `gap` (24, from half of it to half as much again), and
// each turn lands within `over` (6) of the outline, more often past it than
// short, but for one in four that stops up to a third of the way in. Where the form narrows to nothing or parts in two, the hand lifts and
// each part gets a line of its own. The line is `width` (13) wide, laid as
// the pencil fill's own pieces side by side, so its grain is the paper's
// `tooth`: fullest down the middle and under a pressing hand, bare on more
// peaks toward its edges and where the hand eased. `tone` (0.5) is the
// strength of one piece; pieces overlap, so the line is denser than a fill of
// that tone. Keep `width` near half of `gap`, or the fill closes.
function scribble(g, R, name, region, colour, opts = {}) {
  const { angle = longAxis(region), gap = 24, width = 13, tone = 0.5, over = 6 } = opts;
  const ux = Math.cos(angle); const uy = Math.sin(angle);
  let d0 = Infinity; let d1 = -Infinity; let s0 = Infinity; let s1 = -Infinity;
  for (const [x, y] of region) {
    const d = x * ux + y * uy; const s = y * ux - x * uy;
    d0 = Math.min(d0, d); d1 = Math.max(d1, d); s0 = Math.min(s0, s); s1 = Math.max(s1, s);
  }
  const at = (d, s) => [ux * d - uy * s, uy * d + ux * s];
  const lines = [];
  let open = [];
  let k = 0;
  for (let d = d0 + gap * 0.5 * R(name, 'start'); d < d1; d += gap * (0.5 + R(name, 'gap', k)), k++) {
    // The stretches of this swing's line that lie inside the form.
    const runs = [];
    let from = null;
    for (let s = s0; s <= s1 + 2; s += 2) {
      const inside = s <= s1 && pointInPoly(at(d, s), region);
      if (inside && from === null) from = s;
      if (!inside && from !== null) { runs.push([from, s - 2]); from = null; }
    }
    // Each stretch carries on the line whose last swing it lies under, or
    // starts a new one; a line with no stretch under it ends here.
    const next = [];
    for (const [a, b] of runs) {
      const i = open.findIndex((line) => line.a <= b && a <= line.b);
      const line = i < 0 ? { pts: [], side: R(name, 'side', k * 7 + next.length) < 0.5 ? 1 : -1 } : open.splice(i, 1)[0];
      if (i < 0) lines.push(line);
      // One turn in four stops well short of the outline, as a loose hand does.
      const lazy = R(name, 'lazy', k * 7 + next.length);
      const past = over * (R(name, 'over', k * 7 + next.length) - 0.4) - (lazy < 0.25 ? (b - a) * (0.1 + lazy) : 0);
      line.pts.push(at(d, line.side > 0 ? b + past : a - past));
      line.side = -line.side; line.a = a; line.b = b;
      next.push(line);
    }
    open = next;
  }
  const batches = new Map();
  const hairs = Math.max(2, Math.round(width / 0.9));
  lines.forEach((line, j) => {
    if (line.pts.length < 2) return;
    // The wrist turns about one point, so every swing of a line bows the same
    // way, and the turns are loops, not corners.
    const wrist = (R(name, 'wrist', j) - 0.5) * 0.16;
    const spine = [line.pts[0]];
    for (let i = 1; i < line.pts.length; i++) {
      const [ax, ay] = line.pts[i - 1]; const [bx, by] = line.pts[i];
      const bow = (i % 2 ? 1 : -1) * (wrist + (R(name, 'bow', j * 97 + i) - 0.5) * 0.06);
      spine.push([(ax + bx) / 2 - (by - ay) * bow, (ay + by) / 2 + (bx - ax) * bow], line.pts[i]);
    }
    const pts = resample(chaikin(spine, 2), 2);
    const n = pts.length;
    const id = name + ' ' + j;
    for (let h = 0; h < hairs; h++) {
      const side = -1 + (2 * (h + R(id, 'side', h))) / hairs;
      let px = null; let py = null;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // The hand presses and eases along the line, and starts and lifts light.
        const press = (0.55 + 0.45 * noise2(R, i * 0.012, 3.1, id + 'p')) * Math.min(1, 0.5 + i / 12, 0.5 + (n - 1 - i) / 12);
        const o = (side * width) / 2 + (noise2(R, i * 0.08, h, id + 'j') - 0.5) * 1.4;
        const x = pts[i][0] - ((b[1] - a[1]) / l) * o; const y = pts[i][1] + ((b[0] - a[0]) / l) * o;
        if (px !== null) piece(batches, R, px, py, x, y, tone * (0.5 + 0.5 * press), 0.14 + 0.3 * side * side + 0.3 * (1 - press));
        px = x; py = y;
      }
    }
  });
  g.save();
  g.lineCap = 'round';
  lay(g, batches, hexRgb(colour), 1.6, hairline(g));
  g.restore();
}

// A region filled soft, with no outline: the pencil laid on its side, for a
// blush, a highlight or a shadow. `tone` 0.2 to 0.5.
function shade(g, R, name, region, colour, tone = 0.3) {
  pencil(g, R, name, region, colour, { tone, spacing: 2.6, w: 3, over: 2, angle: -0.6 + R(name, 'a') * 0.4 });
}

// A character's face centred at (x, y) at size `s`: big eyes with a glint,
// `gap` s apart, a pencil blush under each and a mouth. `mood`: 'happy',
// 'sleep', 'oh', 'cat' or anything else for a flat line; `mouth` false for a
// face that has a beak or a muzzle of its own.
function face(g, R, name, x, y, s, mood = 'happy', gap = 0.34, mouth = true) {
  const eye = (ex) => {
    if (mood === 'sleep') {
      const arc = [];
      for (let i = 0; i <= 8; i++) { const a = 0.35 + (i / 8) * (Math.PI - 0.7); arc.push([ex + Math.cos(a) * s * 0.11, y - s * 0.02 + Math.sin(a) * s * 0.08]); }
      pen(g, R, name + 'e' + ex, arc, { w: 2.2, skip: 0 });
      return;
    }
    g.fillStyle = rgba(INK.brown, 0.96);
    path(g, ellipse(ex, y, s * 0.085, s * 0.105, 24));
    g.fill();
    g.fillStyle = rgba([255, 255, 255], 0.9);
    g.beginPath();
    g.arc(ex + s * 0.03, y - s * 0.04, s * 0.03, 0, Math.PI * 2);
    g.fill();
  };
  eye(x - s * gap / 2);
  eye(x + s * gap / 2);
  for (const side of [-1, 1]) shade(g, R, name + 'b' + side, ellipse(x + side * s * (gap / 2 + 0.12), y + s * 0.12, s * 0.09, s * 0.055, 16), PENCIL.pink, 0.5);
  const my = y + s * 0.17;
  if (!mouth) return;
  if (mood === 'happy') {
    const smile = [];
    for (let i = 0; i <= 8; i++) { const a = 0.4 + (i / 8) * (Math.PI - 0.8); smile.push([x + Math.cos(a) * s * 0.08, my + Math.sin(a) * s * 0.06]); }
    pen(g, R, name + 'm', smile, { w: 2, skip: 0 });
  } else if (mood === 'oh' || mood === 'cat') {
    // Too small for `pen`, whose wobble step would leave the ring two
    // points and the zigzag a dash: both are plain ink strokes.
    g.strokeStyle = rgba(INK.brown, 0.85);
    g.lineWidth = 1.8;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (mood === 'oh') path(g, ellipse(x, my + s * 0.02, s * 0.035, s * 0.045, 14));
    else path(g, [[x - s * 0.07, my], [x - s * 0.035, my + s * 0.04], [x, my], [x + s * 0.035, my + s * 0.04], [x + s * 0.07, my]], false);
    g.stroke();
  } else {
    pen(g, R, name + 'm', [[x - s * 0.04, my + s * 0.01], [x + s * 0.04, my + s * 0.01]], { w: 1.8, skip: 0 });
  }
}

// Letters from the stroke font, `size` tall from (x, y), each one its own pen
// strokes, set a little off the line and turned, as a hand writes them.
// `inks` alternates per letter. Returns the x where the text ends.
function letter(g, R, name, text, x, y, size, inks = ['brown'], w = 2.2) {
  const k = size / 7;
  let px = x;
  let i = 0;
  for (const ch of text) {
    const rot = (R(name, 'rot', i) - 0.5) * 0.16; const dy = (R(name, 'dy', i) - 0.5) * size * 0.1;
    const cx = px + 2 * k; const cy = y + 3.5 * k + dy;
    for (const [j, run] of font.glyph(ch).entries()) {
      const pts = run.map(([u, v]) => {
        const dx = (u - 2) * k; const dv = (v - 3.5) * k;
        return [cx + dx * Math.cos(rot) - dv * Math.sin(rot), cy + dx * Math.sin(rot) + dv * Math.cos(rot)];
      });
      pen(g, R, name + i + '_' + j, pts, { ink: inks[i % inks.length], w, wob: 0.8, skip: 0.06 });
    }
    px += 5.4 * k;
    i++;
  }
  return px - 1.4 * k;
}

// A fold from `a` to `b` that was pressed flat: a shadow on one side, a light
// on the other, and a thin dark line where the fibres broke.
function crease(g, R, name, a, b) {
  const line = wobble([a, b], R, name, 5, 60);
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l; const ny = dx / l;
  g.save();
  g.lineCap = 'round';
  for (const [side, colour, alpha] of [[1, [60, 40, 20], 0.009], [-1, [255, 255, 255], 0.022]]) {
    for (let k = 8; k >= 1; k--) {
      g.strokeStyle = rgba(colour, alpha);
      g.lineWidth = k * 5;
      path(g, line.map(([x, y]) => [x + nx * side * (k * 1.5 + 2), y + ny * side * (k * 1.5 + 2)]), false);
      g.stroke();
    }
  }
  g.strokeStyle = rgba([60, 40, 20], 0.07);
  g.lineWidth = 1.2;
  path(g, line, false);
  g.stroke();
  g.restore();
}

// The sheet, `w` by `h`: cream paper mottled by soft patches, with its tooth.
// `folds` (true) folds it in half each way and once across, with two short
// creases: the halves take the light differently and each fold is a `crease`.
function paper(g, R, w, h, opts = {}) {
  const { colour = PAPER, folds = true } = opts;
  g.fillStyle = colour;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < Math.round((70 * w * h) / 1e6); i++) {
    const x = R('mottle', 'x', i) * w; const y = R('mottle', 'y', i) * h; const r = 60 + R('mottle', 'r', i) * 180;
    const soft = g.createRadialGradient(x, y, 0, x, y, r);
    const c = R('mottle', 't', i) < 0.5 ? '255, 255, 255' : '90, 70, 40';
    soft.addColorStop(0, 'rgba(' + c + ', 0.05)');
    soft.addColorStop(1, 'rgba(' + c + ', 0)');
    g.fillStyle = soft;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (folds) {
    const vx = w * 0.3 + R('fold', 'vx') * (w * 0.4); const hy = h * 0.32 + R('fold', 'hy') * (h * 0.36);
    // The folded halves took the light differently.
    g.fillStyle = rgba([60, 40, 20], 0.025);
    g.fillRect(0, 0, vx, h);
    g.fillStyle = rgba([255, 255, 255], 0.05);
    g.fillRect(0, hy, w, h - hy);
    crease(g, R, 'foldv', [vx + (R('fold', 'v0') - 0.5) * 60, -20], [vx + (R('fold', 'v1') - 0.5) * 60, h + 20]);
    crease(g, R, 'foldh', [-20, hy + (R('fold', 'h0') - 0.5) * 60], [w + 20, hy + (R('fold', 'h1') - 0.5) * 60]);
    const d = R('fold', 'd') < 0.5;
    crease(g, R, 'foldd', [d ? -20 : w + 20, h * 0.08 + R('fold', 'd0') * (h * 0.2)], [d ? w * 0.55 : w * 0.45, h + 20]);
    for (let i = 0; i < 2; i++) {
      const x = R('fold', 'sx', i) * w; const y = R('fold', 'sy', i) * h; const a = R('fold', 'sa', i) * Math.PI; const l = 60 + R('fold', 'sl', i) * 120;
      crease(g, R, 'folds' + i, [x - Math.cos(a) * l, y - Math.sin(a) * l], [x + Math.cos(a) * l, y + Math.sin(a) * l]);
    }
  }
  grain(g, R, 'grain', w, h, Math.round((6000 * w * h) / 1e6), 'rgba(255, 255, 255, 0.3)', 'rgba(90, 70, 40, 0.05)');
}

module.exports = { PAPER, INK, PENCIL, rgba, paper, crease, tooth, pen, dot, pencil, drag, scribble, shade, face, letter };
