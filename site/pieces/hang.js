// The wall of sixteen styles: the Kandinsky the knife scraped, framed, among
// one work of each other style, each that style's site demo (site/demos) of
// the site's bird, matted and framed alike and laid out on the table in the
// order of HUNG, four to a row. The
// shots after the Kandinsky draw it through a camera onto the frame, in the
// sheet's units, the Kandinsky's window where the knife's camera saw it.
//
// ONE FRAME FOR ALL. The mats are one board and the frames one moulding in the
// ink, so sixteen styles read as one hang, not sixteen pictures pasted in.
//
// WHAT STAYS IS KEPT. The Kandinsky is kept at the knife's camera, and each
// other work at the largest size the camera ever shows it (see held.js sized);
// a frame lays copies, a few fills and the frames' shadows.

'use strict';

const { span, ease } = require('../../core/time.js');
const { sized } = require('./held.js');
const Dr = require('./draft.js');
const Im = require('./impasto.js');
const Sc = require('./scrape.js');
const { TABLE } = require('./dry.js');
// The styles on the wall, in hanging order; every one but the Kandinsky is a demo below.
const HUNG = ['papercraft', 'render-3d', 'cad', 'pixel-art', 'embroidery', 'sticker', 'voxel', 'doodle',
  'kandinsky', 'impasto', 'circuit-board', 'watercolour', 'sumi-e', 'star-atlas', 'light-painting', 'pen-and-pencil'];

const MODULES = [
  require('../demos/papercraft.js'),
  require('../demos/render-3d.js'),
  require('../demos/cad.js'),
  require('../demos/pixel-art.js'),
  require('../demos/embroidery.js'),
  require('../demos/sticker.js'),
  require('../demos/voxel.js'),
  require('../demos/doodle.js'),
  require('../demos/impasto.js'),
  require('../demos/circuit-board.js'),
  require('../demos/watercolour.js'),
  require('../demos/sumi-e.js'),
  require('../demos/star-atlas.js'),
  require('../demos/light-painting.js'),
  require('../demos/pen-and-pencil.js'),
];

const BOARD = '#f3eee3';              // the mats
const CORE = ['#fbf8f1', '#d8d0c1'];  // a mat's bevelled edge, lit and shaded
const WOOD = [22, 22, 27];            // the moulding, in the ink
const HALF = [Im.CLOSE.c, [600 / Im.CLOSE.z, 400 / Im.CLOSE.z]];   // the knife's view: centre and half size
const SHEET = Im.VIEW;                // the painting's sheet: the ground and the paint reach its edges
const KW = Math.round(HALF[1][0] * 2 * 0.94), A = Math.round(HALF[1][1] * 2 * 0.94);   // the Kandinsky's window, and every other's side
const MAT = 62, MOULD = 18, DEEP = 10;   // a mat's margin, the moulding's width and its depth
const GAP = [120, 130];               // between frames, across and down
const PER = 4;                        // works to a row: sixteen as a square

/** Build stage: where every work hangs; each other style's demo by its name. */
function hang(s) {
  const byName = new Map(MODULES.map((m) => [m.name, m]));
  const works = HUNG.map((name, i) => {
    const kandinsky = name === 'kandinsky';
    if (!kandinsky && !byName.has(name)) throw new Error(`hang: no demo for the style ${name}`);
    return { name, i, row: Math.floor(i / PER), col: i % PER, w: kandinsky ? KW : A, h: A, module: kandinsky ? null : byName.get(name) };
  });
  const k = works.find((w) => !w.module);
  const outer = (w) => w.w + 2 * (MAT + MOULD);
  // Each row centred on one line, the Kandinsky's window where the knife saw it.
  const rowOf = (r) => works.filter((w) => w.row === r);
  const width = (r) => rowOf(r).reduce((n, w) => n + outer(w), 0) + GAP[0] * (rowOf(r).length - 1);
  let mid = null;
  for (const r of [k.row, ...[...new Set(works.map((w) => w.row))].filter((r) => r !== k.row)]) {
    let x = mid === null ? 0 : mid - width(r) / 2;
    for (const w of rowOf(r)) { w.x = x + outer(w) / 2; x += outer(w) + GAP[0]; }
    if (mid === null) {
      const shift = HALF[0][0] - k.x;
      for (const w of rowOf(r)) w.x += shift;
      mid = rowOf(r)[0].x - outer(rowOf(r)[0]) / 2 + width(r) / 2;
    }
  }
  const pitch = A + 2 * (MAT + MOULD) + GAP[1];
  for (const w of works) w.y = HALF[0][1] + (w.row - k.row) * pitch;
  const x0 = Math.min(...works.map((w) => w.x - outer(w) / 2)), x1 = Math.max(...works.map((w) => w.x + outer(w) / 2));
  const y0 = Math.min(...works.map((w) => w.y - w.h / 2 - MAT - MOULD)), y1 = Math.max(...works.map((w) => w.y + w.h / 2 + MAT + MOULD));
  s.hang = { works, k, box: [x0, y0, x1, y1], most: new Map(), order: [] };
}

/**
 * Record, for the camera `v`, how large each work shows: a work is kept at the
 * largest size any camera recorded shows at least half of it at. A glimpse of
 * a work's edge as the camera passes needs no more.
 */
function seen(s, v) {
  const [vx0, vy0, vx1, vy1] = view(v);
  for (const w of s.hang.works) {
    const x = Math.min(vx1, w.x + w.w / 2) - Math.max(vx0, w.x - w.w / 2), y = Math.min(vy1, w.y + w.h / 2) - Math.max(vy0, w.y - w.h / 2);
    if (x <= 0 || y <= 0) continue;
    if (!s.hang.order.includes(w)) s.hang.order.push(w);
    if (x * y >= w.w * w.h / 2) s.hang.most.set(w, Math.max(s.hang.most.get(w) || 0, w.h * v.z));
  }
}

/** What camera `v` sees, in the sheet's units, with a margin for shadows; `v.half` is half its frame, 600 by 400 when absent. */
function view(v) {
  const [fw, fh] = v.half || [600, 400], hw = fw / v.z + 40, hh = fh / v.z + 40;
  return [v.c[0] - hw, v.c[1] - hh, v.c[0] + hw, v.c[1] + hh];
}

/** The camera that shows the whole hang. */
function whole(s) {
  const [x0, y0, x1, y1] = s.hang.box;
  return { c: [(x0 + x1) / 2, (y0 + y1) / 2], z: Math.min(1200 / (x1 - x0), 800 / (y1 - y0)) / 1.08, turn: 0 };
}

/** The camera that shows the Kandinsky's frame whole, a little table round it. */
function chosen(s) {
  const k = s.hang.k, ow = k.w + 2 * (MAT + MOULD), oh = k.h + 2 * (MAT + MOULD);
  return { c: [k.x, k.y], z: Math.min(1200 / ow, 800 / oh) / 1.05, turn: 0 };
}

const BACK = [0, 1.8];                 // the camera draws back to the sheet
const PULL = [3.4, 6.6];               // the camera draws back to the whole hang
const WALL_SECONDS = 12;               // the wall shot's length; wall.cjs and score.js read it
const MOVE = [7.8, 12.6];              // ends after the wall, so the camera still moves at its last frame

/**
 * The camera `u` of the way from `p` to `q`, zooming evenly in scale and
 * moving across by `w(u)` of the way: late when drawing back, so the
 * Kandinsky holds its place until the rest is small, and early when going in,
 * so it is found before the camera closes on it.
 */
function between(p, q, u, w) {
  const a = w(u);
  return { c: [p.c[0] + (q.c[0] - p.c[0]) * a, p.c[1] + (q.c[1] - p.c[1]) * a], z: p.z * (q.z / p.z) ** u, turn: 0 };
}

/** The wall's camera at its second `sec` (see wall.cjs); the unstick seam goes on from its last frame. */
function camera(s, sec) {
  const all = whole(s), drift = { c: [all.c[0] + 60, all.c[1] - 20], z: all.z * 0.97, turn: 0 };
  const sheet = { c: Im.CLOSE.c, z: 1, turn: 0 }, landed = { c: Im.CLOSE.c, z: 0.93, turn: 0 };
  if (sec < BACK[1]) return Dr.towards(Im.CLOSE, sheet, ease.inOut(span(BACK[0], BACK[1], sec)));
  if (sec < PULL[0]) return Dr.towards(sheet, landed, span(BACK[1], PULL[0], sec) * 0.5);
  const from = Dr.towards(sheet, landed, 0.5);
  if (sec < PULL[1]) return between(from, all, ease.inOut(span(PULL[0], PULL[1], sec)), (u) => u * u * u);
  if (sec < MOVE[0]) return Dr.towards(all, drift, span(PULL[1], MOVE[0], sec));
  return between(drift, chosen(s), ease.inOut(span(MOVE[0], MOVE[1], sec)), (u) => 1 - (1 - u) ** 3);
}

/** Build stage: how large the wall's camera ever shows each work, so every shot that frames the hang keeps them alike. */
function frames(s) {
  for (let sec = 0; sec <= WALL_SECONDS; sec += 1 / 30) seen(s, camera(s, sec));
}

// The solves the painting's and the works' copies are kept under, by seed and parameters; the last few seeds.
const painters = new Map();
const PAINTERS = 3;

/**
 * The solve to keep `solved`'s painting and works under: the first seen of its
 * seed and parameters. The wall and every piece of the score draw the same
 * Kandinsky and the same works from the same build, so the score lays the
 * wall's copies instead of making its own.
 */
function shared(solved) {
  const seen = solved.seed + ' ' + JSON.stringify(solved.params || {}), s = painters.get(seen) || solved;
  painters.delete(seen);
  painters.set(seen, s);
  if (painters.size > PAINTERS) painters.delete(painters.keys().next().value);
  return s;
}

/**
 * The Kandinsky as the knife left it, on the whole of the sheet it was
 * painted on (SHEET, a margin past the knife's view): the impasto and every
 * step over the ground it scraped down to. Kept at the knife's camera with its
 * pixels on the frame's, so the first frame is the Kandinsky shot's last.
 * { copy, m } for Dr.put, with the `ground` it was scraped down to, the copy null on a surface that keeps none.
 */
function painting(g, solved) {
  if (!g.canvas || typeof g.getTransform !== 'function') return { copy: null, m: null };
  const s = shared(solved);
  const k = Dr.shot(Im.CLOSE), m = g.getTransform().multiply({ a: k.a, b: k.b, c: -k.b, d: k.a, e: k.x, f: k.y });
  const [x0, y0, x1, y1] = SHEET, p0 = m.transformPoint({ x: x0, y: y0 }), p1 = m.transformPoint({ x: x1, y: y1 });
  // Whole multiples of 4 pixels: the ground's soft stain is laid at a quarter of the resolution (see impasto.js).
  const px = 4 * Math.ceil(-p0.x / 4), py = 4 * Math.ceil(-p0.y / 4), w = Math.ceil(p1.x) + px, h = Math.ceil(p1.y) + py;
  m.e += px;
  m.f += py;
  const key = [m.a, m.e, m.f].map((n) => n.toFixed(3)).join(' ');
  const on = (paint) => (cg, cs) => {
    cg.setTransform(m);
    cg.beginPath();
    cg.rect(x0, y0, x1 - x0, y1 - y0);
    cg.clip();
    paint(cg, cs);
  };
  const ground = sized(g, s, 'ground ' + key, w, h, on(Sc.paintGround));
  const copy = sized(g, s, 'kandinsky ' + key, w, h, on((cg, cs) => {
    Sc.paintImpasto(cg, cs);
    for (let j = 0; j < cs.steps.length; j++) Sc.drawStep(cg, cs, j, 1, ground ? { copy: ground, m } : null);
  }));
  return { copy, m, ground };
}

// A soft shadow, blurred once: a square whose edges fall off over BLUR
// pixels either side, laid in nine parts so the fall-off keeps its width
// under a thing of any size.
const SHADE = 128, BLUR = 16, EDGE = 3 * BLUR;
function shade(g, s) {
  return sized(g, s, 'shadow', SHADE, SHADE, (cg) => {
    cg.shadowColor = 'rgba(0, 0, 0, 1)';
    cg.shadowBlur = BLUR;
    cg.shadowOffsetX = 1000;
    cg.fillStyle = '#000';
    cg.fillRect(2 * BLUR - 1000, 2 * BLUR, SHADE - 4 * BLUR, SHADE - 4 * BLUR);
  });
}

/** How many pixels a side work `w` is kept at, at `dev` device pixels to a design pixel. */
const sideOf = (s, w, dev) => Math.max(1, Math.min(1000, Math.ceil(s.hang.most.get(w) * dev)));

/** Work `w`'s own drawing, kept at `px` pixels a side (the Kandinsky's is kept apart). */
function art(g, s, w, px, early) {
  // The side is in the key: a copy is laid by its own size (see drawHang), so only one of that size is shared.
  return sized(g, shared(s), 'work ' + w.name + ' ' + px, px, px, (cg, cs) => {
    cg.setTransform(px / 1000, 0, 0, px / 1000, 0, 0);
    w.module.draw(cg, { seed: cs.seed });
  }, early);
}

// Solves whose works are being made ahead, so each is scheduled once.
const scheduled = new WeakSet();

/**
 * Make every work's drawing while the browser is idle, one at a time in the
 * order the camera first shows them, so that none is made on a frame the
 * visitor sees: a style module takes from a few to a few hundred
 * milliseconds. A work not yet made when a frame needs it is made then; made
 * ahead or then, it is the same drawing at the same size.
 */
function prepare(g, s, dev) {
  if (scheduled.has(s) || typeof requestIdleCallback !== 'function' || !g.canvas) return;
  scheduled.add(s);
  const todo = s.hang.order.filter((w) => w.module);
  // A pixel of each work read back as it is made, so the browser draws it
  // now and not on the next frame of whatever shot is on screen.
  const sink = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) : null;
  const next = () => {
    const w = todo.shift(), img = w && art(g, s, w, sideOf(s, w, dev), true);
    if (!img) return;
    if (sink) { sink.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1); sink.getImageData(0, 0, 1, 1); }
    requestIdleCallback(next);
  };
  requestIdleCallback(next);
}

const tone = (rgb, k) => `rgb(${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c + k)))).join(', ')})`;

/**
 * The ring between rectangles `o` and `i` ([x0, y0, x1, y1]), each side
 * filled by `fill(nx, ny)`, its outward normal.
 */
function ring(g, o, i, fill) {
  const sides = [
    [[o[0], o[1]], [o[2], o[1]], [i[2], i[1]], [i[0], i[1]], 0, -1],
    [[o[2], o[1]], [o[2], o[3]], [i[2], i[3]], [i[2], i[1]], 1, 0],
    [[o[2], o[3]], [o[0], o[3]], [i[0], i[3]], [i[2], i[3]], 0, 1],
    [[o[0], o[3]], [o[0], o[1]], [i[0], i[1]], [i[0], i[3]], -1, 0],
  ];
  for (const [a, b, c, d, nx, ny] of sides) {
    g.fillStyle = fill(nx, ny);
    g.beginPath();
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]);
    g.closePath();
    g.fill();
  }
}

const grow = (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];

/**
 * Work `w`'s frame round its window `win`, lit from `lx, ly` (a unit vector
 * towards the light): the moulding, the mat and its bevel, and their shadows
 * on the mat and on the work. The work itself goes in first, by the caller.
 */
function frame(g, win, lx, ly) {
  const bevel = grow(win, 4), matOut = grow(win, MAT), mid = grow(win, MAT + MOULD * 0.45), out = grow(win, MAT + MOULD);
  // The mat, with the window cut through it.
  g.fillStyle = BOARD;
  g.beginPath();
  g.rect(matOut[0], matOut[1], matOut[2] - matOut[0], matOut[3] - matOut[1]);
  g.rect(bevel[2], bevel[1], bevel[0] - bevel[2], bevel[3] - bevel[1]);
  g.fill();
  // The mat's own shadow on the work, along the edges towards the light, and the moulding's on the mat.
  edgeShadow(g, win, lx, ly, 9, 0.38);
  edgeShadow(g, matOut, lx, ly, 14, 0.3);
  // The bevel: the board's white core, cut at a slope down into the window.
  ring(g, bevel, win, (nx, ny) => CORE[-(nx * lx + ny * ly) > 0 ? 0 : 1]);
  // The moulding: its inner slope and its outer, each side lit by how it faces the light.
  ring(g, mid, matOut, (nx, ny) => tone(WOOD, 26 * -(nx * lx + ny * ly) + 8));
  ring(g, out, mid, (nx, ny) => tone(WOOD, 30 * (nx * lx + ny * ly) + 4));
}

/** A soft shadow cast inwards from the edges of `r` that face the light, `d` deep, at most `a` dark. */
function edgeShadow(g, r, lx, ly, d, a) {
  const edges = [[0, -1, r[0], r[1], r[2], r[1] + d], [1, 0, r[2] - d, r[1], r[2], r[3]], [0, 1, r[0], r[3] - d, r[2], r[3]], [-1, 0, r[0], r[1], r[0] + d, r[3]]];
  for (const [nx, ny, x0, y0, x1, y1] of edges) {
    const k = nx * lx + ny * ly;
    if (k <= 0.05) continue;
    const gx = nx ? (nx > 0 ? [x1, x0] : [x0, x1]) : null, gy = ny ? (ny > 0 ? [y1, y0] : [y0, y1]) : null;
    const grad = gx ? g.createLinearGradient(gx[0], 0, gx[1], 0) : g.createLinearGradient(0, gy[0], 0, gy[1]);
    grad.addColorStop(0, `rgba(20, 14, 8, ${(a * k).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(20, 14, 8, 0)');
    g.fillStyle = grad;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

/** Work `w`'s window, [x0, y0, x1, y1]. */
const windowOf = (w) => [w.x - w.w / 2, w.y - w.h / 2, w.x + w.w / 2, w.y + w.h / 2];

/**
 * The hang seen by camera `v` at scale `dev` (device pixels to a design
 * pixel), in the sheet's units, lit from angle `light`. `lifted(g, k)` draws
 * the Kandinsky and its frame, for a shot that moves them; by default they lie
 * framed like the rest.
 */
function drawHang(g, s, v, dev, light, kandinsky, lifted) {
  const [vx0, vy0, vx1, vy1] = view(v), lx = Math.cos(light), ly = Math.sin(light);
  g.fillStyle = TABLE;
  g.beginPath();
  g.rect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  g.fill();
  const sh = shade(g, s);
  for (const w of s.hang.works) {
    const win = windowOf(w), out = grow(win, MAT + MOULD + DEEP * 3);
    if (out[2] < vx0 || out[0] > vx1 || out[3] < vy0 || out[1] > vy1) continue;
    if (!w.module && lifted) continue;
    castShadow(g, sh, grow(win, MAT + MOULD), lx, ly, 0);
    if (w.module) {
      const px = sideOf(s, w, dev);
      const img = art(g, s, w, px);
      if (img) g.drawImage(img, 0, 0, px, px, win[0], win[1], w.w, w.h);
      else { g.save(); g.translate(win[0], win[1]); g.scale(w.w / 1000, w.h / 1000); w.module.draw(g, { seed: s.seed }); g.restore(); }
    } else {
      g.save();
      g.beginPath();
      g.rect(win[0], win[1], w.w, w.h);
      g.clip();
      kandinsky(g);
      g.restore();
    }
    frame(g, win, lx, ly);
  }
  if (lifted) lifted(g, s.hang.k, sh, lx, ly);
}

/**
 * The light over the table, `k` of its strength: a warm pool on the side it
 * comes from, falling off into shade across the hang, moving as it turns.
 */
function glow(g, s, v, light, k) {
  if (k <= 0) return;
  const [x0, y0, x1, y1] = view(v), [bx0, by0, bx1, by1] = s.hang.box, r = (bx1 - bx0) * 0.8;
  const cx = (bx0 + bx1) / 2 + Math.cos(light) * r * 0.4, cy = (by0 + by1) / 2 + Math.sin(light) * r * 0.4;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, `rgba(255, 238, 208, ${(0.12 * k).toFixed(3)})`);
  grad.addColorStop(0.4, `rgba(255, 238, 208, ${(0.03 * k).toFixed(3)})`);
  grad.addColorStop(1, `rgba(8, 5, 2, ${(0.42 * k).toFixed(3)})`);
  g.fillStyle = grad;
  g.beginPath();
  g.rect(x0, y0, x1 - x0, y1 - y0);
  g.fill();
}

/** How far a frame `lift` units above the table casts its shadow, the light high over it. */
const cast = (lift) => (DEEP + lift) * 0.3 + 4;

/**
 * The shadow on the table of a flat thing covering `r`, `lift` units above
 * it, `dark` at most: cast away from the light and softer the higher it is.
 */
function castShadow(g, sh, r, lx, ly, lift, dark = 0.8) {
  if (!sh) return;
  const b = 7 + lift * 0.25, d = cast(lift), x0 = r[0] - lx * d, y0 = r[1] - ly * d, x1 = r[2] - lx * d, y1 = r[3] - ly * d;
  // Source and target cuts: BLUR outside the edge and BLUR inside it, then the flat middle.
  const sx = [0, EDGE, SHADE - EDGE, SHADE], tx = [x0 - 2 * b, x0 + b, x1 - b, x1 + 2 * b], ty = [y0 - 2 * b, y0 + b, y1 - b, y1 + 2 * b];
  if (tx[2] < tx[1] || ty[2] < ty[1]) return;
  g.save();
  g.globalAlpha = dark * Math.max(0.35, 1 - lift * 0.004);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    g.drawImage(sh, sx[i], sx[j], sx[i + 1] - sx[i], sx[j + 1] - sx[j], tx[i], ty[j], tx[i + 1] - tx[i], ty[j + 1] - ty[j]);
  }
  g.restore();
}

module.exports = { HUNG, WALL_SECONDS, hang, camera, frames, painting, prepare, drawHang, glow, frame, castShadow, grow, windowOf, SHEET, MAT, MOULD };
