// Sumi-e: black ink on rice paper, in few strokes and much empty space. A
// stroke is a brush of bristles pressed and lifted along a path: solid where
// the brush is wet, breaking into streaks of bare paper where it runs dry,
// and bleeding a soft halo into the paper where the ink is thin. One brush
// carries every tone from pale wash to black.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { fbm } = require('../../../core/rand.js');
const { chaikin, resample } = require('../../../core/geom.js');
const { path, sub, ellipse } = require('./kit.js');

const INK = [22, 19, 17];
const PAPER = '#f1eadb';
// The one ink at a darkness from 0 (bare paper) to 1 (black).
const ink = (a) => 'rgba(' + INK.join(', ') + ', ' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';

// Pressure over a stroke's length. Swell, blunt and press enter with the tip
// turned back into the hair, so they start wide and round; sweep enters and
// leaves on the fine point of the tip; press eases in from half on one smooth
// curve, so a heavy stroke swells without a corner; taper enters on the point at 0.2,
// presses to about 0.93 within the first tenth and lifts to a point; flick enters
// on the point, presses down within a fifth of the stroke and lifts to a point.
const PRESS = {
  swell: (t) => 0.55 + 0.45 * Math.sin(Math.PI * t),
  taper: (t) => (0.2 + 0.8 * Math.sin(Math.min(1, t * 10) * Math.PI / 2)) * (1 - t) ** 0.7,
  flick: (t) => (0.2 + 0.8 * Math.sin(Math.min(1, t * 5) * Math.PI / 2)) * (1 - t) ** 0.7,
  blunt: (t) => 0.85 + 0.15 * Math.sin(Math.PI * t),
  press: (t) => (1 - 0.5 * Math.exp(-8 * t)) * (1 - 0.6 * t ** 3),
  sweep: (t) => 0.2 + 0.8 * Math.sin(Math.PI * t),
};

// One brush stroke along `spine`, `w` wide at full pressure. `tone` is the
// ink's darkness, `dry` how much of the stroke the brush runs dry for (0
// never), `grade` how much paler one side of the brush was loaded, `bleed`
// how far thin ink creeps into the paper, `press` one of PRESS, `bristles`
// how many hairs streak the dry part.
function brush(g, R, name, spine, opts = {}) {
  const { w = 20, tone = 0.9, dry = 0.3, grade = 0.3, bleed = 0, press = PRESS.swell, bristles = 34 } = opts;
  const pts = resample(spine.length > 2 ? chaikin(spine, 3) : spine, 2);
  const n = pts.length;
  if (n < 2) return;
  const normal = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  });
  const half = pts.map((p, i) => (w / 2) * press(i / (n - 1)));
  // Each edge wobbles on its own slow noise; a point between the spine and an
  // edge moves with that edge.
  const wob = [1, -1].map((side) => pts.map((p, i) => 1 + 0.14 * (fbm(R, i * 0.04, side * 7.1, 2, name + 'edge') - 0.5)));
  const off = (i, side) => half[i] * side * wob[side < 0 ? 1 : 0][i];
  const at = (i, side) => [pts[i][0] + normal[i][0] * off(i, side), pts[i][1] + normal[i][1] * off(i, side)];
  // The brush across its width: lanes of hairs between uneven boundaries
  // from side -1 to 1. Where the brush gives out each lane holds ink to its
  // own reach, neighbours in loose clumps, so the wet body ends raggedly.
  const wetEnd = Math.max(2, Math.round(n * (1 - dry)));
  const tail = Math.min(24, (n - wetEnd) * 0.8);
  const L = Math.max(8, Math.min(28, Math.round(w / 3)));
  const edges = [-1];
  for (let k = 1; k < L; k++) edges.push(-1 + (2 * (k + (R(name, 'lane', k) - 0.5) * 0.7)) / L);
  edges.push(1);
  const reach = edges.slice(1).map((_, k) => {
    const q = 0.5 * R(name, 'reach', k) + 0.5 * Math.max(0, Math.min(1, (fbm(R, k * 0.3, 1.7, 2, name + 'reach') - 0.3) / 0.4));
    return Math.max(1, Math.min(n - 1, wetEnd - 1 + Math.round(tail * (1.2 * q - 0.2))));
  });
  // The start: the round of the pressed tip, behind the first point, from
  // side `lo` to side `hi`. It flattens as the entry pressure falls from half
  // to a fifth, so a fine entry ends flat at its point, with no paler nub.
  const deep = Math.min(1, Math.max(0, (half[0] / (w / 2 || 1) - 0.2) / 0.3));
  const cap = (lo, hi) => {
    const a0 = Math.acos(lo); const a1 = Math.acos(hi);
    const m = Math.max(2, Math.ceil(((a0 - a1) * 8) / Math.PI));
    const out = [];
    for (let k = 0; k <= m; k++) {
      const a = a0 + ((a1 - a0) * k) / m; const u = Math.cos(a); const v = Math.sin(a) * deep;
      out.push([pts[0][0] + (normal[0][0] * u - normal[0][1] * v) * half[0], pts[0][1] + (normal[0][1] * u + normal[0][0] * v) * half[0]]);
    }
    return out;
  };
  // The wet body from side -1 up to side `top`: forward along `top`, round
  // the end of each lane it covers, back along side -1, then the cap.
  const lanes = (top) => {
    let hi = 1;
    while (hi < L && edges[hi] < top) hi++;
    const out = [];
    for (let i = 0; i <= reach[hi - 1]; i++) out.push(at(i, top));
    for (let k = hi - 1; k >= 0; k--) {
      const r = reach[k]; const r2 = k > 0 ? reach[k - 1] : 0;
      out.push(at(Math.min(n - 1, r + (R(name, 'tip', k) < 0.5 ? 1 : 0)), (edges[k] + Math.min(top, edges[k + 1])) / 2));
      for (let i = r, step = r2 >= r ? 1 : -1; ; i += step) {
        out.push(at(i, edges[k]));
        if (i === r2) break;
      }
    }
    return out.concat(cap(-1, top));
  };
  // Bristles: each runs dry at its own point, then skips, leaving streaks of
  // bare paper that grow toward the end of the stroke. A hair starts inside
  // the wet body and shares its fill, so it shows only where the body has
  // ended. Each run is a ribbon no wider than twice the hair's share of the
  // local width. A skip cuts a run short; where a hair gives out its last run
  // draws out to a long point, and late in the stroke the hairs splay a little.
  // The outer hairs are finer and stay inside the brush's edge, so a run there
  // never stands out of the stroke as a separate round-ended pod.
  const from = Math.max(0, wetEnd - 4 - Math.round(tail * 0.2));
  const hairs = [];
  for (let j = 0; j < bristles; j++) {
    const side = -1 + (2 * (j + 0.5)) / bristles + (R(name, 'off', j) - 0.5) * (1.4 / bristles);
    const runs = 1 - dry * (0.15 + 0.85 * R(name, 'quit', j));
    const full = Math.max(0.7, (w / bristles) * (0.9 + 1.2 * R(name, 'thick', j)));
    const rings = [];
    let run = [];
    for (let i = from; i <= n; i++) {
      const t = i / (n - 1);
      const worn = t < runs ? 0 : (t - runs) / Math.max(0.05, 1 - runs);
      if (i < n && half[i] > 0.4 && fbm(R, i * 0.06, j * 1.9, 2, name + 'skip') > 0.25 + 0.5 * worn) {
        const s = Math.max(-1, Math.min(1, side + 0.4 * worn * (fbm(R, i * 0.05, j * 2.3, 2, name + 'splay') - 0.5)));
        const r = (Math.min(full, (4 * half[i]) / bristles) / 2) * (1 - 0.5 * s ** 8);
        run.push([i, Math.max(off(i, -1) + r, Math.min(off(i, 1) - r, off(i, s))), r]);
        continue;
      }
      if (run.length > 1) {
        // A run that starts inside the wet body widens slowly, so its start never shows.
        const m = run.length; const kIn = Math.min(run[0][0] === from ? 10 : 2, m / 3); const kOut = Math.min(2 + 8 * worn, m / 2);
        const edge = ([i, mid, r], p, s) => {
          const o = mid + s * r * Math.min(1, (p + 0.5) / kIn, (m - 0.5 - p) / kOut) ** 0.8;
          return [pts[i][0] + normal[i][0] * o, pts[i][1] + normal[i][1] * o];
        };
        const ring = run.map((q, p) => edge(q, p, 1));
        for (let p = m - 1; p >= 0; p--) ring.push(edge(run[p], p, -1));
        rings.push(ring);
      }
      run = [];
    }
    hairs.push([side, rings]);
  }
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (bleed > 0) {
    // Thin ink creeps into the fibres round the wet body: four layers whose
    // reach follows the paper's thirst and a finer noise along the edge, so
    // the halo widens, thins and frays as it goes, with a few wicks of ink
    // run out along single fibres.
    const rim = [];
    const tangent = (i) => [normal[i][1], -normal[i][0]];
    for (let i = 0; i < wetEnd; i += 2) rim.push([...at(i, 1), ...normal[i]]);
    for (let k = L - 1; k >= 0; k--) {
      const mid = (edges[k] + edges[k + 1]) / 2; const [tx, ty] = tangent(reach[k]); const [nx, ny] = normal[reach[k]];
      const l = Math.hypot(tx + nx * mid, ty + ny * mid) || 1;
      rim.push([...at(reach[k], mid), (tx + nx * mid) / l, (ty + ny * mid) / l]);
    }
    for (let i = wetEnd - 1; i >= 0; i -= 2) rim.push([...at(i, -1), -normal[i][0], -normal[i][1]]);
    const [tx, ty] = tangent(0);
    cap(-1, 1).forEach(([x, y], k, all) => {
      const a = Math.PI * (1 - k / (all.length - 1));
      rim.push([x, y, normal[0][0] * Math.cos(a) - tx * Math.sin(a), normal[0][1] * Math.cos(a) - ty * Math.sin(a)]);
    });
    g.fillStyle = ink(tone * 0.045);
    for (let k = 1; k <= 4; k++) {
      path(g, rim.map(([x, y, ox, oy], p) => {
        const e = bleed * 0.75 * k * (0.2 + 1.6 * thirst(R, x, y)) * (0.7 + 0.6 * fbm(R, p * 0.45, k * 5.3, 2, name + 'bleed'));
        return [x + ox * e, y + oy * e];
      }));
      g.fill();
    }
    g.strokeStyle = ink(tone * 0.07);
    g.lineWidth = 0.6;
    g.beginPath();
    rim.forEach(([x, y, ox, oy], p) => {
      if (R(name, 'wick', p) > 0.25) return;
      const l = bleed * (1 + 4 * R(name, 'wl', p)) * (0.3 + thirst(R, x, y)); const a = (R(name, 'wa', p) - 0.5) * 1.4;
      g.moveTo(x, y);
      g.lineTo(x + (ox * Math.cos(a) - oy * Math.sin(a)) * l, y + (ox * Math.sin(a) + oy * Math.cos(a)) * l);
    });
    g.stroke();
  }
  // The ink: one fill of the whole wet body and every hair at the paler
  // side's tone, then nested layers from the darker side, one per two levels
  // of 8-bit grey between the sides, each darkening by the same amount, so
  // `grade` shades across the brush in an even ramp and a hair is as dark as
  // the body beside it. A fill never darkens itself where its parts overlap,
  // so the wet body stays solid and the round start matches the rest.
  const pale = tone * (1 - 0.45 * grade); const dark = Math.min(0.985, tone);
  const steps = Math.max(0, Math.ceil((dark - pale) * 110));
  const level = (k) => pale + ((dark - pale) * k) / steps;
  for (let k = 0; k <= steps; k++) {
    const top = 1 - (2 * k) / (steps + 1);
    g.fillStyle = ink(k ? 1 - (1 - level(k)) / (1 - level(k - 1)) : pale);
    g.beginPath();
    sub(g, lanes(top));
    for (const [side, rings] of hairs) if (side < top) for (const ring of rings) sub(g, ring);
    g.fill();
  }
  g.restore();
}

// How readily the paper drinks thin ink at (x, y), from 0 to 1: one field for
// the whole sheet, so strokes over the same fibres bleed alike.
const thirst = (R, x, y) => Math.max(0, Math.min(1, (fbm(R, x * 0.03, y * 0.03, 3, 'sumi-e paper') - 0.3) / 0.4));

// A dot pressed with the tip: a disc of radius `r` at `tone` inside a faint
// halo of thin ink. Knots, buds, moss, stamens.
function dot(g, x, y, r, tone) {
  g.fillStyle = ink(tone * 0.12);
  g.beginPath();
  g.arc(x, y, r * 1.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ink(tone);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// Rice paper over a `w` x `h` sheet: warm ground, a shade darker toward the
// edges, and `fibres` short curved fibres, light or brown. Leaves lineCap round.
function paper(g, R, name, w, h, fibres = 520) {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  const shade = g.createRadialGradient(w / 2, h * 0.47, Math.min(w, h) * 0.26, w / 2, h / 2, Math.max(w, h) * 0.76);
  shade.addColorStop(0, 'rgba(255, 252, 244, 0.25)');
  shade.addColorStop(1, 'rgba(150, 125, 85, 0.14)');
  g.fillStyle = shade;
  g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  for (let i = 0; i < fibres; i++) {
    const x = R(name, 'x', i) * w; const y = R(name, 'y', i) * h;
    const a = R(name, 'a', i) * Math.PI * 2; const l = 6 + R(name, 'l', i) * 24; const bend = (R(name, 'b', i) - 0.5) * 10;
    g.strokeStyle = R(name, 't', i) < 0.6 ? 'rgba(255, 255, 250, 0.5)' : 'rgba(150, 130, 95, 0.16)';
    g.lineWidth = 0.6 + R(name, 'w', i) * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l / 2 + bend, y + Math.sin(a) * l / 2 - bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
}

// A wash laid wet so it has no edge: `count` very pale ink patches round
// (x, y), radius `r` plus up to `grow`, scattered by `spread` [dx, dy], their
// edges pushed by noise. Mist, night, water, distance.
function wash(g, R, name, x, y, opts = {}) {
  const { count = 36, r: r0 = 110, grow = 250, spread = [140, 110], tone = 0.0075 } = opts;
  for (let k = 0; k < count; k++) {
    const r = r0 + grow * R(name, 'r', k);
    const cx = x + (R(name, 'cx', k) - 0.5) * spread[0]; const cy = y + (R(name, 'cy', k) - 0.5) * spread[1];
    const pts = ellipse(cx, cy, r * 1.3, r * 0.85, 48).map(([px, py], i) => [
      px + (fbm(R, i * 0.25, k * 1.7, 3, name) - 0.5) * r * 0.5, py + (fbm(R, i * 0.25, k * 1.7 + 40, 3, name) - 0.5) * r * 0.4,
    ]);
    g.fillStyle = ink(tone);
    path(g, pts);
    g.fill();
  }
}

// A round form reserved as bare paper: `paint()` runs on a `w` x `h` sheet
// with the circle [x, y, r] left out, then three faint rings soften its rim,
// where the wash crept to the paper's edge.
function reserve(g, w, h, [x, y, r], paint) {
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.arc(x, y, r, 0, Math.PI * 2);
  g.clip('evenodd');
  paint();
  g.restore();
  g.strokeStyle = ink(0.05);
  for (let k = 1; k <= 3; k++) {
    g.lineWidth = k * 3;
    g.beginPath();
    g.arc(x, y, r + k, 0, Math.PI * 2);
    g.stroke();
  }
}

module.exports = { INK, PAPER, ink, PRESS, brush, dot, paper, wash, reserve };
