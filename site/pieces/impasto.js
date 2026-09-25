// The papercraft painted over as impasto (see skills/artifex/styles/impasto.md).
// A wide painting knife spreads a thick cream ground across the torn strips and
// the raised parts in three sweeps; the blueprint paper soaks up its oil, a
// dark stain spreading out from each sweep's edge, and the layers beneath still
// show through the ground as relief. Then a brush lays the paint on thick in
// short dabs: the swirling background first, patch by patch along its flow round
// the bird's relief, then the bird on top, each part's dabs wrapping its form.
//
// ONE LIGHT. Every dab's lit and shadowed ridge, the ground's knife ridges and
// the relief take the light the fold ended on.
//
// All in the sheet's units (see draft.js).

'use strict';

const { rng, fbm } = require('../../core/rand.js');
const { pointInPoly, resample } = require('../../core/geom.js');
const { mix } = require('../../core/colour.js');
const { bird } = require('../../skills/artifex/styles/subject.js');
const { soft } = require('./held.js');
const Dr = require('./draft.js');
const Pc = require('./papercut.js');
const Oil = require('./oil.js');

const CLOSE = { c: [Dr.FRONT[0] + 40, 470], z: 1.75, turn: 0 };   // the fold's last camera
const VIEW = [-20, 200, 760, 740];         // what that camera sees, with a margin
const TAU = Math.PI * 2;
const K = Dr.SCALE / 290;                  // the style's units (a bird of 290) to the sheet's
const GROUND = '#f3ead8';
const FIRE = [[0.36, '#c8412a'], [0.43, '#e0612a'], [0.5, '#f08a3c'], [0.56, '#f7b267'], [0.62, '#f4dcb8'], [9, '#fbf3e6']];
const PALETTES = {
  body: ['#8e98bf', '#c9b8b9', '#e6d3c1', '#f6ebd9', '#fffaf1'],
  wing: ['#b8352a', '#d6452f', '#ea6a45', '#f39a6b'],
  tail: ['#b8352a', '#c8412a', '#e0573a', '#f08a3c'],
  beak: ['#d99a2b', '#e9b949', '#f2c94c'],
};

const COAT = [0.35, 3.05];                 // the knife spreads the ground
const SWEEPS = [470, 300, 640];            // each sweep's middle, in the order laid
const BLADE = 230;                         // the knife's edge
const DABS = [3.0, 9.45];                  // the brush lays the paint
const BATCH = 0.4;                         // dabs kept in copies this many seconds at a time

/** The light the fold ends on, as a unit vector towards it. */
const lightOf = (s) => { const a = s.light + 0.2; return [Math.cos(a), Math.sin(a)]; };

/** The bird's parts as the fold left them: each on its layer, a little larger the higher. */
function risen(s) {
  const out = {};
  for (const p of Pc.PARTS) {
    const [k, , , , e, f] = Pc.lifted(p.high, s.centre);
    out[p.name] = s.parts[p.name].shapes.map((poly) => poly.map(([x, y]) => [k * x + e, k * y + f]));
  }
  return out;
}

/** Build stage: the ground's sweeps and the relief under them. */
function coat(s) {
  const R = rng(s.seed);
  const span = (COAT[1] - COAT[0]) / SWEEPS.length;
  s.sweeps = SWEEPS.map((y, i) => {
    const dir = i % 2 ? -1 : 1, bow = (R('sweep', 'bow', i) - 0.5) * 40, tilt = (R('sweep', 'tilt', i) - 0.5) * 30;
    const line = [];
    for (let j = 0; j <= 40; j++) {
      const u = j / 40;
      line.push([dir > 0 ? VIEW[0] - 80 + u * (VIEW[2] - VIEW[0] + 160) : VIEW[2] + 80 - u * (VIEW[2] - VIEW[0] + 160), y + bow * Math.sin(Math.PI * u) + tilt * (u - 0.5)]);
    }
    const pts = resample(line, 6), n = pts.map((p, j) => {
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    });
    // Knife marks along the sweep: where across the blade, how light or dark, how far they run.
    const streaks = [];
    for (let k = 0; k < 26; k++) {
      streaks.push({ at: (R('streak', 'at', i * 40 + k) - 0.5) * BLADE * 0.94, w: 0.6 + R('streak', 'w', i * 40 + k) * 2.2, a: 0.05 + R('streak', 'a', i * 40 + k) * 0.1, lit: R('streak', 'lit', i * 40 + k) < 0.55, from: R('streak', 'from', i * 40 + k) * 0.5 });
    }
    const t0 = COAT[0] + i * span, t1 = t0 + span * 0.86;
    return { pts, n, streaks, t0, t1, tone: mix(GROUND, i % 2 ? '#efe2cc' : '#f7f0e2', 0.15 + R('sweep', 'tone', i) * 0.2) };
  });
  // The relief the ground is laid over: the risen parts, and the strips' torn edges where they parted.
  const parts = risen(s);
  s.relief = [
    ...Object.values(parts).flat().map((p) => [...p, p[0]]),
    ...s.tears.flatMap((edge) => [edge.map(([x, y]) => [x, y])]),
    s.tears[0].map(([x, y]) => [x, y - 26]),
    s.tears[1].map(([x, y]) => [x, y + 30]),
  ];
  s.risen = parts;
}

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** How far along its line sweep `w` has gone at second `sec`, as a count of its points. */
const reach = (w, sec) => ease((sec - w.t0) / (w.t1 - w.t0)) * (w.pts.length - 1);

function side(w, upto, off) {
  const out = [];
  for (let j = 0; j <= upto; j++) out.push([w.pts[j][0] + w.n[j][0] * off, w.pts[j][1] + w.n[j][1] * off]);
  return out;
}

function band(g, w, upto, fresh = true) {
  const a = side(w, upto, -BLADE / 2), b = side(w, upto, BLADE / 2);
  if (fresh) g.beginPath();
  g.moveTo(a[0][0], a[0][1]);
  for (const p of a) g.lineTo(p[0], p[1]);
  for (let j = b.length - 1; j >= 0; j--) g.lineTo(b[j][0], b[j][1]);
  g.closePath();
}

function stroke(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let j = 1; j < pts.length; j++) g.lineTo(pts[j][0], pts[j][1]);
  g.stroke();
}

/**
 * The ground at second `sec` over whatever is drawn beneath: each sweep in
 * the order laid (see drawSweep). `marks` scales its knife marks, ridges and
 * relief, which a knife scraping it later smooths.
 */
function drawCoat(g, s, sec, marks = 1, relief = marks) {
  s.sweeps.forEach((w, i) => { if (sec > w.t0) drawSweep(g, s, i, sec, marks, relief); });
}

/** Whole sweeps laid by second `sec`. */
const sweepsBy = (s, sec) => s.sweeps.filter((w) => w.t1 <= sec).length;

/**
 * Sweep `i` as far as it has gone at second `sec`: the oil soaking out into
 * the bare paper past its edges, the ground with its knife marks, the ridges
 * its edges leave, the paint heaped at the blade, and the layers beneath
 * raised through it.
 */
function drawSweep(g, s, i, sec, marks = 1, relief = marks) {
  const L = lightOf(s), w = s.sweeps[i];
  const r = reach(w, sec), upto = Math.min(w.pts.length - 1, Math.ceil(r));
  if (upto < 1) return;
  const grow = Math.min(1, (sec - w.t0) / (w.t1 - w.t0));
  g.save();
  // Only the paper soaks: not the ground already laid.
  for (let j = 0; j < i; j++) { g.beginPath(); g.rect(-3000, -3000, 8000, 8000); band(g, s.sweeps[j], s.sweeps[j].pts.length - 1, false); g.clip('evenodd'); }
  soft(g, 4, (sg) => {
    sg.lineJoin = 'round';
    sg.strokeStyle = `rgba(2, 6, 26, ${0.2 + 0.45 * grow})`;
    sg.lineWidth = 8 + 40 * grow;
    for (const off of [-1, 1]) stroke(sg, side(w, upto, off * (BLADE / 2 + 2)));
  });
  g.restore();
  const tex = grounds(g, s);
  if (tex) {
    // The ground as laid, lit: see grounds.
    g.save();
    band(g, w, upto);
    g.clip();
    g.imageSmoothingEnabled = true;
    g.drawImage(tex[i], VIEW[0], VIEW[1], VIEW[2] - VIEW[0], VIEW[3] - VIEW[1]);
    g.restore();
    if (sec < w.t1) heap(g, w, upto);
    return;
  }
  g.save();
  band(g, w, upto);
  g.fillStyle = w.tone;
  g.fill();
  g.clip();
  g.lineCap = 'round';
  g.globalAlpha = marks;
  for (const k of w.streaks) {
    const j0 = Math.floor(k.from * upto);
    if (upto - j0 < 2) continue;
    g.strokeStyle = k.lit ? `rgba(255, 252, 244, ${k.a * 2})` : `rgba(120, 96, 64, ${k.a})`;
    g.lineWidth = k.w;
    stroke(g, side(w, upto, k.at).slice(j0));
  }
  // The layers beneath, raised through it.
  g.globalAlpha = relief;
  drawRelief(g, s, L);
  g.restore();
  g.save();
  g.globalAlpha = marks;
  // The ridges its two edges leave: lit where the edge faces the light, a shadow beyond the other.
  for (const off of [-1, 1]) {
    const e = side(w, upto, off * BLADE / 2), faces = off * (w.n[0][0] * L[0] + w.n[0][1] * L[1]) > 0;
    g.lineCap = 'round';
    g.strokeStyle = faces ? 'rgba(255, 253, 246, 0.7)' : 'rgba(70, 52, 34, 0.32)';
    g.lineWidth = faces ? 1.6 : 2.6;
    stroke(g, e);
  }
  if (sec < w.t1) heap(g, w, upto);
  g.restore();
}

/** The paint heaped along the blade's edge while it is laying. */
function heap(g, w, upto) {
  const p = w.pts[upto], n = w.n[upto], d = [n[1], -n[0]];
  g.save();
  g.lineCap = 'round';
  for (const [off, width, style] of [[-1, 7, 'rgba(120, 96, 64, 0.25)'], [2, 5, 'rgba(250, 244, 230, 1)'], [3, 1.6, 'rgba(255, 255, 255, 0.9)']]) {
    g.strokeStyle = style;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(p[0] - n[0] * BLADE / 2 + d[0] * off, p[1] - n[1] * BLADE / 2 + d[1] * off);
    g.lineTo(p[0] + n[0] * BLADE / 2 + d[0] * off, p[1] + n[1] * BLADE / 2 + d[1] * off);
    g.stroke();
  }
  g.restore();
}

// The ground's sweeps as height fields, lit, per seed and scale: they follow
// from the seed alone, so the paint seam and the Kandinsky shot share them.
// The few last used are kept.
const kept = new Map();
const KEPT = 4;

/**
 * Each sweep of the ground as an image over VIEW, or null where none can be
 * kept: thick paint spread by a knife, its surface streaked along the sweep
 * and chattered across it, a raised lip along each edge, and the parts and
 * the strips of the papercraft raised through it, lit by the one light with a
 * gloss on what faces it.
 */
function grounds(g, s) {
  if (!g.canvas || typeof g.getTransform !== 'function' || typeof g.drawImage !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  const m = g.getTransform(), r = Math.round(Math.hypot(m.a, m.b) * 0.4 * 64) / 64;
  const key = s.seed + '|' + r;
  let tex = kept.get(key);
  if (tex === undefined) tex = texture(s, r);
  kept.delete(key);
  kept.set(key, tex);
  while (kept.size > KEPT) kept.delete(kept.keys().next().value);
  return tex;
}

function texture(s, r) {
  const W = Math.ceil((VIEW[2] - VIEW[0]) * r), H = Math.ceil((VIEW[3] - VIEW[1]) * r);
  // The papercraft under the ground, as heights: the strips as they parted, the parts as they rose.
  const rg = new OffscreenCanvas(W, H).getContext('2d');
  rg.setTransform(r, 0, 0, r, -VIEW[0] * r, -VIEW[1] * r);
  const fillPoly = (pts, v) => {
    rg.fillStyle = `rgb(${Math.round(v * 255)}, 0, 0)`;
    rg.beginPath();
    pts.forEach(([x, y], j) => (j ? rg.lineTo(x, y) : rg.moveTo(x, y)));
    rg.closePath();
    rg.fill();
  };
  const [a, b] = s.tears, far = 3000;
  fillPoly([[-far, -far], [far, -far], ...a.map(([x, y]) => [x, y - 26]).reverse()], 0.42);
  fillPoly([...a.map(([x, y]) => [x, y]), ...b.map(([x, y]) => [x, y]).reverse()], 0.28);
  fillPoly([...b.map(([x, y]) => [x, y + 30]), [far, far], [-far, far]], 0.18);
  for (const [name, v] of [['tail', 0.5], ['body', 0.56], ['beak', 0.6], ['wing', 0.72]]) for (const p of s.risen[name]) fillPoly(p, v);
  const raw = rg.getImageData(0, 0, W, H).data, R = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) R[i] = raw[i * 4] / 255;
  blur(R, W, H, Math.max(1, Math.round(3 * r)));
  blur(R, W, H, Math.max(1, Math.round(3 * r)));
  const L = lightOf(s), lz = Math.sin(0.5), lx = L[0] * Math.cos(0.5), ly = L[1] * Math.cos(0.5);
  const hl = Math.hypot(lx, ly, lz + 1), hx = lx / hl, hy = ly / hl, hz = (lz + 1) / hl;
  return s.sweeps.map((w, i) => {
    const out = new OffscreenCanvas(W, H), og = out.getContext('2d'), im = og.createImageData(W, H), d = im.data;
    // The sweep's middle over each column.
    const pts = w.pts.slice().sort((p, q) => p[0] - q[0]), mid = new Float32Array(W);
    let j = 0;
    for (let px = 0; px < W; px++) {
      const x = VIEW[0] + (px + 0.5) / r;
      while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
      const p = pts[j], q = pts[j + 1], u = Math.max(0, Math.min(1, (x - p[0]) / (q[0] - p[0] || 1)));
      mid[px] = p[1] + (q[1] - p[1]) * u;
    }
    const Hh = new Float32Array(W * H), C = new Float32Array(W * H);
    const [cr, cg, cb] = [1, 3, 5].map((k) => parseInt(w.tone.slice(k, k + 2), 16));
    for (let py = 0; py < H; py++) {
      const y = VIEW[1] + (py + 0.5) / r;
      for (let px = 0; px < W; px++) {
        const x = VIEW[0] + (px + 0.5) / r, tt = (y - mid[px]) / (BLADE / 2), e = Math.abs(tt);
        if (e > 1.02) continue;
        const edge = 0.95 + 0.05 * Oil.vnoise(x / 26, i * 7.1, 31);
        if (e > edge) continue;
        const k = py * W + px;
        C[k] = Math.min(1, (edge - e) * (BLADE / 2) * r);
        const lip = 0.6 * Math.exp(-(((edge - e - 0.045) / 0.035) ** 2));
        const streak = 0.24 * (Oil.vnoise(x / 160 + i * 9, tt * 11, 33) - 0.5) + 0.1 * (Oil.vnoise(x / 40, tt * 38 + i, 35) - 0.5);
        const chatter = 0.05 * Math.sin(x * 0.29 + 6 * Oil.vnoise(x / 50, tt * 2 + i, 37)) * Math.max(0, Oil.vnoise(x / 90, tt * 1.5 + i, 39) - 0.55) * 2.2;
        Hh[k] = (1 + lip + streak + chatter + 1.1 * R[k]) * 2.2;
      }
    }
    for (let py = 1; py < H - 1; py++) {
      for (let px = 1; px < W - 1; px++) {
        const k = py * W + px;
        if (C[k] <= 0) continue;
        const nx0 = -(Hh[k + 1] - Hh[k - 1]) / 2, ny0 = -(Hh[k + W] - Hh[k - W]) / 2, nl = Math.hypot(nx0, ny0, 1);
        const nx = nx0 / nl, ny = ny0 / nl, nz = 1 / nl;
        const shade = 1 + (nx * lx + ny * ly + nz * lz - lz) * 0.9, gloss = 110 * Math.max(0, nx * hx + ny * hy + nz * hz) ** 50;
        d[k * 4] = Math.min(255, cr * shade + gloss);
        d[k * 4 + 1] = Math.min(255, cg * shade + gloss);
        d[k * 4 + 2] = Math.min(255, cb * shade + gloss);
        d[k * 4 + 3] = C[k] * 255;
      }
    }
    og.putImageData(im, 0, 0);
    return out;
  });
}

/** A box blur of radius `n` over the field `F`, W by H, in place. */
function blur(F, W, H, n) {
  const T = new Float32Array(F.length);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -n; x <= n; x++) acc += F[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      T[y * W + x] = acc / (2 * n + 1);
      acc += F[y * W + Math.min(W - 1, x + n + 1)] - F[y * W + Math.max(0, x - n)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -n; y <= n; y++) acc += T[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      F[y * W + x] = acc / (2 * n + 1);
      acc += T[Math.min(H - 1, y + n + 1) * W + x] - T[Math.max(0, y - n) * W + x];
    }
  }
}


/** The layers under the ground: a lit rim towards the light, a soft shade away from it. */
function drawRelief(g, s, L) {
  g.lineJoin = 'round';
  for (const [dx, dy, style, width] of [[-L[0] * 2.2, -L[1] * 2.2, 'rgba(90, 70, 46, 0.14)', 4], [L[0] * 1.2, L[1] * 1.2, 'rgba(255, 253, 248, 0.5)', 1.6]]) {
    g.save();
    g.translate(dx, dy);
    g.strokeStyle = style;
    g.lineWidth = width;
    for (const p of s.relief) stroke(g, p);
    g.restore();
  }
}

/** The ground laid whole, as the brush finds it: opaque over the view. */
function drawGround(g, s, marks = 1, relief = marks) {
  g.fillStyle = GROUND;
  g.beginPath();
  g.rect(VIEW[0] - 400, VIEW[1] - 400, VIEW[2] - VIEW[0] + 800, VIEW[3] - VIEW[1] + 800);
  g.fill();
  drawCoat(g, s, COAT[1] + 5, marks, relief);
  g.globalAlpha = 1;
  if (marks < 1 && grounds(g, s)) {
    // Smoothed by a knife: its marks and the relief flattened towards the plain ground.
    g.globalAlpha = 1 - marks;
    g.fillStyle = GROUND;
    g.fillRect(VIEW[0], VIEW[1], VIEW[2] - VIEW[0], VIEW[3] - VIEW[1]);
    g.globalAlpha = 1;
  }
}

// A dab: where, along which angle, its half length and half width, and its colour (see oil.js).
// A brush stroke covers more than the style's ellipse of the same size: the paint spreads under it.
const makeDab = (x, y, a, len, wide, colour) => ({ x, y, a, len: len * 1.25, wide: wide * 1.45, colour });

/** Build stage: every dab, where and when the brush lays it. */
function dabs(s) {
  const R = rng(s.seed), L = lightOf(s);
  const b = bird(Dr.FRONT[0], Dr.FRONT[1], Dr.SCALE), parts = s.risen;
  const centre = b.at([[0.05, 0.02]])[0], head = b.at([[0.42, -0.42]])[0], light = b.at([[0.15, -0.12]])[0];
  const axis = (p, q) => { const [u, v] = b.at([p, q]); return Math.atan2(v[1] - u[1], v[0] - u[0]); };
  const wingAxis = axis([0.2, -0.08], [-0.6, -0.24]), tailAxis = axis([-0.55, -0.02], [-1.05, -0.3]), beakAxis = axis([0.7, -0.35], [1.0, -0.34]);
  // A palette colour, or between two neighbours in it a quarter at a time, as paint mixed on the canvas.
  const pick = (pal, t) => {
    const x = Math.max(0, Math.min(pal.length - 1, t * pal.length - 0.5)), i = Math.floor(x), q = Math.round((x - i) * 4) / 4;
    return q === 0 || i + 1 >= pal.length ? pal[i] : mix(pal[i], pal[i + 1], q);
  };
  const lit = (x, y, c, r) => 0.5 + ((x - c[0]) * L[0] + (y - c[1]) * L[1]) / r;
  const inside = (p, name) => parts[name].some((poly) => pointInPoly(p, poly));
  const within = (p) => ['body', 'wing', 'tail', 'beak'].some((n) => parts[n].slice(0, 1).some((poly) => pointInPoly(p, poly)));

  // The bird: a jittered grid over it, each dab turned to its part's form; painted part by part, spiralling round each.
  const groups = { tail: [], body: [], wing: [], beak: [] };
  const all = ['body', 'wing', 'tail', 'beak'].flatMap((n) => parts[n][0]);
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  const step = 9 * K;
  let i = 0;
  for (let y = y0 - step; y < y1 + step; y += step) {
    for (let x = x0 - step; x < x1 + step; x += step, i++) {
      const p = [x + R('bird', 'x', i) * 8 * K, y + R('bird', 'y', i) * 8 * K];
      const wob = (R('bird', 'a', i) - 0.5) * 0.5, len = (11 + R('bird', 'l', i) * 5) * K, wide = (4.2 + R('bird', 'w', i) * 1.8) * K;
      if (inside(p, 'beak') ) groups.beak.push(makeDab(p[0], p[1], beakAxis + wob, len * 0.8, wide, pick(PALETTES.beak, lit(p[0], p[1], b.at([[0.85, -0.34]])[0], 40 * K))));
      else if (inside(p, 'wing')) groups.wing.push(makeDab(p[0], p[1], wingAxis + wob, len, wide, pick(PALETTES.wing, lit(p[0], p[1], b.at([[-0.2, -0.1]])[0], 160 * K))));
      else if (parts.body[0] && pointInPoly(p, parts.body[0])) {
        const c = Math.hypot(p[0] - head[0], p[1] - head[1]) < 0.3 * Dr.SCALE ? head : centre;
        groups.body.push(makeDab(p[0], p[1], Math.atan2(p[1] - c[1], p[0] - c[0]) + Math.PI / 2 + wob, len, wide, pick(PALETTES.body, lit(p[0], p[1], light, 250 * K))));
      } else if (inside(p, 'tail')) groups.tail.push(makeDab(p[0], p[1], tailAxis + wob, len, wide, pick(PALETTES.tail, lit(p[0], p[1], b.at([[-0.8, -0.2]])[0], 90 * K))));
    }
  }
  // Round each part from its middle out, as a brush wraps a form.
  const spiral = (list, c, ring) => list.map((d) => {
    const r = Math.hypot(d.x - c[0], d.y - c[1]), a = (Math.atan2(d.y - c[1], d.x - c[0]) + TAU) % TAU;
    return [Math.floor(r / ring) + a / TAU, d];
  }).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const mid = (list) => [list.reduce((a, d) => a + d.x, 0) / list.length, list.reduce((a, d) => a + d.y, 0) / list.length];
  const order = [];
  for (const name of ['tail', 'body', 'wing', 'beak']) if (groups[name].length) order.push(...spiral(groups[name], mid(groups[name]), 22));
  // Accents: navy under the body, gold along the wing's edge, the eye and a blush.
  const body = b.body, wingLine = parts.wing[0];
  body.forEach((p, j) => {
    if (p[1] < centre[1] + 0.12 * Dr.SCALE || j % 3) return;
    const q = body[(j + 1) % body.length];
    order.push(makeDab(p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]), 11 * K, 3.6 * K, '#27365e'));
  });
  wingLine.forEach((p, j) => {
    if (j % 4) return;
    const q = wingLine[(j + 1) % wingLine.length];
    order.push(makeDab(p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]), 9 * K, 3 * K, '#f2c94c'));
  });
  for (const [dx, dy, a] of [[-4, 0, 0.4], [4, 2, -0.3], [0, -4, 1.2]]) order.push(makeDab(b.eye[0] + dx * K, b.eye[1] + dy * K, a, 8 * K, 5 * K, '#1f2a4a'));
  order.push(makeDab(b.eye[0] + 3 * K, b.eye[1] - 4 * K, 0.6, 4 * K, 2.2 * K, '#fffaf1'));
  for (const [dx, dy] of [[-6, 2], [6, 0], [0, 6]]) order.push(makeDab(b.cheek[0] + dx * K, b.cheek[1] + dy * K, 0.2, 7 * K, 3.5 * K, '#f29a9a'));

  // The background: a jittered grid over the view, along the flow, spiralling out from the bird.
  const V = [[150, 330, 1], [590, 290, -1], [130, 660, -1], [620, 650, 1]];
  const flow = (x, y) => {
    let vx = 0.55, vy = -0.8;
    for (const [cx, cy, sg] of V) { const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy + 9000 * K * K; vx += (-dy * sg * 180 * K) / d2; vy += (dx * sg * 180 * K) / d2; }
    return Math.atan2(vy, vx) + (fbm(R, x / (260 * K), y / (260 * K), 3, 'flow') - 0.5) * 2.2;
  };
  const back = [], gap = 19 * K;
  i = 0;
  for (let y = VIEW[1]; y < VIEW[3]; y += gap) {
    for (let x = VIEW[0]; x < VIEW[2]; x += gap, i++) {
      const px = x + R('bg', 'x', i) * 18 * K, py = y + R('bg', 'y', i) * 18 * K;
      if (within([px, py])) continue;
      const warp = (fbm(R, px / (420 * K), py / (420 * K), 2, 'warp') - 0.5) * 1.6, d = Math.hypot(px - centre[0], py - centre[1]);
      let v = fbm(R, px / (230 * K) + warp, py / (230 * K), 4, 'fire') + 0.14 * Math.exp(-(d * d) / (2 * (250 * K) ** 2)) + (R('bg', 'j', i) - 0.5) * 0.06;
      v = Math.min(v, 0.999);
      // Across a threshold the two colours mix, a quarter at a time.
      const b = FIRE.findIndex(([edge]) => v < edge), near = b > 0 ? (v - FIRE[b - 1][0]) / 0.03 : 9;
      let colour = near < 1 ? mix(FIRE[b - 1][1], FIRE[b][1], 0.5 + Math.round(near * 2) / 4) : FIRE[b][1];
      if (b + 1 < FIRE.length && (FIRE[b][0] - v) / 0.03 < 1) colour = mix(FIRE[b][1], FIRE[b + 1][1], 0.5 - Math.round(((FIRE[b][0] - v) / 0.03) * 2) / 4);
      if (R('bg', 'gold', i) < 0.015) colour = '#e9b949';
      back.push(makeDab(px, py, flow(px, py), (17 + R('bg', 'l', i) * 10) * K, (6 + R('bg', 'w', i) * 3) * K, colour));
    }
  }
  // Painted in patches, as a painter works: a patch at a time, here and there
  // over the whole view, each laid along the flow; the first where the view
  // shows it; the bird last, on top of the background round its relief.
  const CELL = 55, cells = new Map();
  for (const d of back) {
    const key = Math.floor(d.x / CELL) + ',' + Math.floor(d.y / CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(d);
  }
  const patches = [...cells.entries()].map(([key, list], j) => {
    const [cx, cy] = key.split(',').map((v) => (Number(v) + 0.5) * CELL), f = flow(cx, cy), u = [Math.cos(f), Math.sin(f)];
    list.sort((p, q) => p.x * u[0] + p.y * u[1] - (q.x * u[0] + q.y * u[1]));
    return { list, c: [cx, cy], when: 0.6 * Oil.vnoise(cx / 240, cy / 240, 5) + 0.4 * R('patch', 'when', j) };
  }).sort((p, q) => p.when - q.when);
  const firstAt = patches.findIndex((p) => p.c[0] > 120 && p.c[0] < 620 && p.c[1] > 290 && p.c[1] < 650);
  patches.unshift(...patches.splice(firstAt, 1));
  order.unshift(...patches.flatMap((p) => p.list));

  // When each is laid, and how long the brush takes over it: slowly at first, a dab at a time, then as a time-lapse.
  const n = order.length, slow = 7, pace = 0.16;
  const fast = (DABS[1] - DABS[0] - slow * pace) / (n - slow);
  order.forEach((d, j) => {
    d.t = DABS[0] + (j < slow ? j * pace : slow * pace + (j - slow) * fast);
    d.dur = j < slow ? 0.12 : 0.05;
  });
  // Wet into wet: each dab drags a little of the dab laid beside it just before.
  order.forEach((d, j) => {
    const q = order[j - 1];
    if (q && q.colour !== d.colour && Math.hypot(q.x - d.x, q.y - d.y) < 3 * d.len) d.under = q.colour;
  });
  Oil.palette(s, order, [], L);
  s.dabs = order;
  s.batches = [];
  for (let t = DABS[0] + BATCH, j = 0; t < DABS[1] + BATCH; t += BATCH) {
    const start = j;
    while (j < n && order[j].t + order[j].dur < t) j++;
    s.batches.push([start, j]);
  }
}

/** How many dabs have been laid by second `sec`. */
function laid(s, sec) {
  const d = s.dabs;
  let lo = 0, hi = d.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (d[m].t <= sec) lo = m + 1; else hi = m; }
  return lo;
}

/** Whole batches laid by second `sec`. */
const batchesBy = (s, sec) => Math.max(0, Math.min(s.batches.length, Math.floor((sec - DABS[0]) / BATCH)));

/** The brush at second `sec`: along the dab it is laying, or in the air between two, and its shadow. */
function drawBrush(g, s, sec) {
  const n = laid(s, sec), d = s.dabs;
  if (sec < DABS[0] - 0.6 || sec > DABS[1] + 0.6) return;
  // Where a dab starts and ends: the brush touches down at one end and lifts at the other.
  const from = (q) => [q.x - Math.cos(q.a) * q.len, q.y - Math.sin(q.a) * q.len], to = (q) => [q.x + Math.cos(q.a) * q.len, q.y + Math.sin(q.a) * q.len];
  let p, down = true;
  if (n === 0) {
    const u = ease((sec - DABS[0] + 0.6) / 0.6), a = from(d[0]);
    p = [a[0] + 400 * (1 - u), a[1] - 260 * (1 - u)];
    down = u >= 1;
  } else {
    const q = d[n - 1], u = (sec - q.t) / q.dur;
    if (u < 1) {
      const a = from(q), b = to(q);
      p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    } else if (n < d.length) {
      const a = to(q), b = from(d[n]), v = (sec - q.t - q.dur) / Math.max(1e-6, d[n].t - q.t - q.dur);
      p = [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v];
      down = false;
    } else {
      const a = to(q), v = ease((sec - q.t - q.dur) / 0.5);
      p = [a[0] + 500 * v, a[1] - 320 * v];
      down = false;
    }
  }
  const L = lightOf(s), colour = n ? d[Math.min(n, d.length) - 1].colour : d[0].colour;
  // The brush: a flat of bristles loaded with the colour it lays, a steel ferrule, a lacquered handle
  // rising away up to the right; its shadow cast away from the light, further the higher each part is.
  const D = [0.8, -0.6], S = [-D[1], D[0]], up = down ? 0 : 1;
  const along = (t, w, rise) => [p[0] + D[0] * t + S[0] * w - L[0] * rise, p[1] + D[1] * t + S[1] * w - L[1] * rise];
  const part = (t0, t1, w0, w1, rise) => {
    g.beginPath();
    const a = along(t0, -w0, 0), b = along(t1, -w1, 0), c = along(t1, w1, 0), e = along(t0, w0, 0);
    const lift = (q, t) => [q[0] - L[0] * rise(t), q[1] - L[1] * rise(t)];
    const pts = [lift(a, t0), lift(b, t1), lift(c, t1), lift(e, t0)];
    g.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) g.lineTo(q[0], q[1]);
    g.closePath();
  };
  const high = (t) => 2 + up * 14 + t * 0.55;
  g.save();
  g.fillStyle = 'rgba(40, 24, 10, 0.13)';
  part(-2, 170, 2.6, 3.8, high);
  g.fill();
  g.fillStyle = 'rgba(40, 24, 10, 0.07)';
  part(-2, 170, 4.2, 6.5, (t) => high(t) + 1.5);
  g.fill();
  // The handle, the ferrule and the bristles, seen from above.
  const lifted = (t) => up * 5 + t * 0.04;
  const grad = (t0, t1, stops) => { const a = along(t0, -6, 0), b = along(t0, 6, 0), gr = g.createLinearGradient(a[0], a[1], b[0], b[1]); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  g.fillStyle = grad(0, 0, [[0, '#5a1f14'], [0.4, '#9b3b24'], [1, '#3a130c']]);
  part(30, 170, 3.4, 4.6, lifted);
  g.fill();
  g.fillStyle = grad(0, 0, [[0, '#8d949b'], [0.45, '#eef1f3'], [1, '#6c737a']]);
  part(15, 31, 3.8, 3.4, lifted);
  g.fill();
  g.fillStyle = mix(colour, '#e8dcc4', 0.45);
  part(1, 16, 3.2, 3.8, lifted);
  g.fill();
  g.fillStyle = colour;
  part(-1, 7, 3.4, 3.6, lifted);
  g.fill();
  g.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  g.lineWidth = 0.7;
  g.beginPath();
  for (const w of [-1.8, 0, 1.8]) { const a = along(-1, w, lifted(0)), b = along(14, w * 1.1, lifted(14)); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
  g.stroke();
  g.restore();
}

/** Where the ground's knife is at second `sec`: its edge's middle, the way it faces, whether it is down. */
function knifeAt(s, sec) {
  const ws = s.sweeps;
  const edge = (w, j) => ({ p: w.pts[j], n: w.n[j] });
  if (sec < ws[0].t0) { const u = ease((sec - ws[0].t0 + 0.45) / 0.45), e = edge(ws[0], 0); return { ...e, p: [e.p[0] - 260 * (1 - u), e.p[1] - 200 * (1 - u)], down: false, on: u > 0 }; }
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (sec <= w.t1) return { ...edge(w, Math.min(w.pts.length - 1, Math.round(reach(w, sec)))), down: true, on: true };
    const next = ws[i + 1];
    if (next && sec < next.t0) {
      const a = edge(w, w.pts.length - 1), b = edge(next, 0), u = ease((sec - w.t1) / (next.t0 - w.t1));
      return { p: [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u], n: u < 0.5 ? a.n : b.n, down: false, on: true };
    }
  }
  const w = ws[ws.length - 1], e = edge(w, w.pts.length - 1), u = ease((sec - w.t1) / 0.5);
  return { ...e, p: [e.p[0] + 300 * u, e.p[1] - 240 * u], down: false, on: u < 1 };
}

/** The ground's knife: a wide steel blade flat on the paint, its crank and handle there by their shadows. */
function drawKnife(g, s, sec) {
  if (sec > COAT[1] + 0.5) return;
  const k = knifeAt(s, sec);
  if (!k.on) return;
  const L = lightOf(s), n = k.n, d = [n[1], -n[0]], up = k.down ? 0 : 1;
  // The blade: its edge on the paint, BLADE across, tapering back to the crank.
  const blade = (ox, oy) => {
    const at = (u, v) => [k.p[0] + ox + d[0] * u + n[0] * v, k.p[1] + oy + d[1] * u + n[1] * v];
    g.beginPath();
    for (const [u, v] of [[0, -BLADE / 2], [-26, -BLADE / 2 + 18], [-58, -14], [-64, 0], [-58, 14], [-26, BLADE / 2 - 18], [0, BLADE / 2]]) { const q = at(u, v); g.lineTo(q[0], q[1]); }
    g.closePath();
  };
  const sx = -L[0] * (3 + up * 16), sy = -L[1] * (3 + up * 16);
  g.save();
  g.fillStyle = 'rgba(30, 20, 10, 0.22)';
  blade(sx, sy);
  g.fill();
  // The crank and handle, rising off the paint: their shadows, long and away from the light.
  const hx = k.p[0] - d[0] * 60 + sx * 2, hy = k.p[1] - d[1] * 60 + sy * 2;
  g.lineCap = 'round';
  for (const [w, a] of [[16, 0.1], [9, 0.14]]) {
    g.strokeStyle = `rgba(30, 20, 10, ${a})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(hx - d[0] * 170 - L[0] * 60, hy - d[1] * 170 - L[1] * 60);
    g.stroke();
  }
  const steel = g.createLinearGradient(k.p[0] + n[0] * BLADE / 2, k.p[1] + n[1] * BLADE / 2, k.p[0] - n[0] * BLADE / 2, k.p[1] - n[1] * BLADE / 2);
  steel.addColorStop(0, '#b9bfc4');
  steel.addColorStop(0.45, '#eef1f2');
  steel.addColorStop(1, '#9aa1a8');
  g.fillStyle = steel;
  blade(0, -up * 4);
  g.fill();
  g.strokeStyle = 'rgba(60, 64, 70, 0.6)';
  g.lineWidth = 1;
  g.stroke();
  g.restore();
}

/** The dabs between counts `from` and `to`, whole, or as far as the brush has laid each by second `sec`. */
function drawDabs(g, s, from, to, sec = Infinity) {
  Oil.drawDabs(g, s, s.dabs.slice(from, to), sec === Infinity ? null : (d) => (sec - d.t) / d.dur);
}

module.exports = { CLOSE, VIEW, COAT, DABS, BATCH, coat, dabs, drawCoat, drawSweep, sweepsBy, drawGround, drawDabs, drawBrush, drawKnife, laid, batchesBy, lightOf };
