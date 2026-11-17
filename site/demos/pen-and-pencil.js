// The showcase site's demo of Pen and pencil: the songbird staged in one
// scene, drawn with the marks of skills/artifex/styles/pen-and-pencil.js.
// Site-only, never a starting point for a piece. The bird sits on a bough
// among a small cast of round characters with faces (a nest, a ladybird,
// fruit, a birdhouse, a kite, a balloon or a planet, a teacup and more), with
// a song, a hand-lettered banner and margin doodles. The seed lays the sheet
// out: each placed thing claims a disc, and everything after the fixed cast
// takes the first candidate spot with room or is left out.

'use strict';

const { rng } = require('../../core/rand.js');
const { chaikin, resample, ribbon } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, ellipse, star, caption } = require('../../skills/artifex/styles/kit.js');
const { PAPER, INK, PENCIL, rgba, paper, pen, dot, pencil, shade, face, letter } = require('../../skills/artifex/styles/pen-and-pencil.js');

const W = 1000; const H = 1000;

// Points along an arc of an ellipse, turned by `rot` about its centre.
function arcPts(cx, cy, r, a0, a1, n = 12, ry = r, rot = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n; const u = Math.cos(a) * r; const v = Math.sin(a) * ry;
    out.push([cx + u * Math.cos(rot) - v * Math.sin(rot), cy + u * Math.sin(rot) + v * Math.cos(rot)]);
  }
  return out;
}

// Unit points placed at (x, y), scaled by s and turned by rot.
const placed = (x, y, s, rot) => (u, v) => [x + (u * Math.cos(rot) - v * Math.sin(rot)) * s, y + (u * Math.sin(rot) + v * Math.cos(rot)) * s];

function heart(cx, cy, s) {
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    pts.push([cx + 16 * Math.sin(t) ** 3 * s, cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * s]);
  }
  return pts;
}

// The bough the subject sits on: thick where it enters from the sheet's edge,
// thin at its tip, a brown pencil fill under the pen, with bark lines along it.
function bough(g, R, name, spine) {
  const n = spine.length;
  const limb = ribbon(spine, (i) => 12 - 8 * (i / (n - 1)));
  pencil(g, R, name + 'f', limb, PENCIL.brown, { tone: 0.3, angle: 0.15, spacing: 3.6 });
  pen(g, R, name + 'o', limb, { close: true, w: 2.2 });
  for (let k = 0; k < 7; k++) {
    const i = 2 + Math.floor(R(name, 'bi', k) * (n - 16)); const l = 6 + Math.floor(R(name, 'bl', k) * 6); const o = (R(name, 'bo', k) - 0.5) * 10;
    pen(g, R, name + 'bark' + k, spine.slice(i, i + l).map(([x, y]) => [x, y + o]), { w: 1.4, tone: 0.55 });
  }
}

function leaf(g, R, name, x, y, s, a) {
  const shape = ellipse(x, y, s, s * 0.42, 16, a);
  pencil(g, R, name + 'f', shape, PENCIL.green, { tone: 0.5, spacing: 2.8, over: 3 });
  pen(g, R, name + 'o', shape, { close: true, w: 2 });
  pen(g, R, name + 'v', [[x - Math.cos(a) * s * 0.8, y - Math.sin(a) * s * 0.8], [x + Math.cos(a) * s * 0.8, y + Math.sin(a) * s * 0.8]], { w: 1.4, skip: 0 });
}

// The cast. Each takes a centre and a size and draws one small person.

// A nest at the bough's tip: eggs with faces behind a bowl of twigs. `y` is
// the bough's top there.
function nest(g, R, name, x, y, s, moods) {
  const cy = y - 0.22 * s;
  const eggs = 2 + Math.floor(R(name, 'n') * 2);
  for (let k = 0; k < eggs; k++) {
    const ex = x + (k - (eggs - 1) / 2) * 0.27 * s; const ey = cy - 0.12 * s + (R(name, 'ey', k) - 0.5) * 0.06 * s;
    const egg = ellipse(ex, ey, 0.13 * s, 0.17 * s, 18);
    g.fillStyle = PAPER;
    path(g, egg);
    g.fill();
    pencil(g, R, name + 'ef' + k, egg, k % 2 ? PENCIL.sky : PENCIL.cream, { tone: 0.3, spacing: 2.4, over: 2 });
    pen(g, R, name + 'eo' + k, egg, { close: true, w: 1.8, skip: 0.05 });
    face(g, R, name + 'e' + k, ex, ey - 0.02 * s, 0.4 * s, moods[k % moods.length], 0.4);
  }
  const bowl = arcPts(x, cy, 0.5 * s, 0, Math.PI, 16, 0.3 * s);
  g.fillStyle = PAPER;
  path(g, bowl);
  g.fill();
  pencil(g, R, name + 'f', bowl, PENCIL.brown, { tone: 0.38, angle: 0.25, spacing: 3 });
  for (let k = 0; k < 9; k++) {
    const tx = x + (R(name, 'tx', k) - 0.5) * 0.7 * s; const ty = cy + R(name, 'ty', k) * 0.2 * s; const a = (R(name, 'ta', k) - 0.5) * 1.2; const l = 0.12 * s + R(name, 'tl', k) * 0.16 * s;
    pen(g, R, name + 'twig' + k, [[tx - Math.cos(a) * l, ty - Math.sin(a) * l], [tx + Math.cos(a) * l, ty + Math.sin(a) * l]], { w: 1.4, tone: 0.6, skip: 0.05 });
  }
  pen(g, R, name + 'o', bowl, { close: true, w: 2.4 });
}

// A ladybird walking the bough, facing `dir`. `y` is the bough's top.
function ladybird(g, R, name, x, y, s, dir) {
  const cy = y - 0.4 * s;
  for (let k = 0; k < 3; k++) pen(g, R, name + 'leg' + k, [[x + (k - 1) * 0.28 * s, cy + 0.3 * s], [x + (k - 1) * 0.34 * s, y]], { w: 1.4, skip: 0 });
  const dome = ellipse(x, cy, 0.5 * s, 0.4 * s, 20);
  pencil(g, R, name + 'f', dome, PENCIL.red, { tone: 0.6, spacing: 2.4, over: 2, cross: true });
  pen(g, R, name + 'o', dome, { close: true, w: 2 });
  pen(g, R, name + 'mid', [[x, cy - 0.4 * s], [x, cy + 0.4 * s]], { w: 1.4, skip: 0 });
  for (const [u, v] of [[-0.25, -0.15], [0.22, -0.1], [-0.2, 0.18], [0.25, 0.2]]) dot(g, x + u * s, cy + v * s, 0.065 * s);
  dot(g, x + dir * 0.5 * s, cy + 0.08 * s, 0.14 * s);
  pen(g, R, name + 'ant1', [[x + dir * 0.58 * s, cy - 0.02 * s], [x + dir * 0.72 * s, cy - 0.28 * s]], { w: 1.2, skip: 0 });
  pen(g, R, name + 'ant2', [[x + dir * 0.6 * s, cy + 0.02 * s], [x + dir * 0.82 * s, cy - 0.12 * s]], { w: 1.2, skip: 0 });
}

// An apple or a pear hanging from the bough by its stalk. `y` is the bough's
// underside there.
function fruit(g, R, name, x, y, s, kind, mood) {
  const stalk = 0.25 * s + R(name, 'stalk') * 0.2 * s; const cy = y + stalk + 0.4 * s;
  pen(g, R, name + 'stalk', [[x, y], [x + 0.04 * s, cy - 0.44 * s]], { w: 2, skip: 0.05 });
  const lf = ellipse(x + 0.14 * s, y + stalk * 0.5, 0.14 * s, 0.06 * s, 12, -0.5);
  pencil(g, R, name + 'lf', lf, PENCIL.green, { tone: 0.5, spacing: 2.4, over: 1 });
  pen(g, R, name + 'lo', lf, { close: true, w: 1.4, skip: 0 });
  let body;
  if (kind === 'apple') {
    body = ellipse(x, cy, 0.4 * s, 0.38 * s, 28).map(([px, py], i) => [px, py + Math.max(0, -Math.sin((i / 28) * Math.PI * 2)) ** 6 * 0.12 * s]);
    pencil(g, R, name + 'f', body, PENCIL.red, { tone: 0.5, angle: -1.1, cross: true });
    shade(g, R, name + 'hi', ellipse(x - 0.14 * s, cy - 0.1 * s, 0.1 * s, 0.14 * s, 12, 0.3), PENCIL.yellow, 0.35);
  } else {
    body = chaikin([[0, -0.5], [0.18, -0.4], [0.26, -0.2], [0.42, 0.05], [0.4, 0.3], [0.22, 0.45], [0, 0.48], [-0.22, 0.45], [-0.4, 0.3], [-0.42, 0.05], [-0.26, -0.2], [-0.18, -0.4]].map(([u, v]) => [x + u * s, cy + v * s]), 2, true);
    pencil(g, R, name + 'f', body, PENCIL.yellow, { tone: 0.5, angle: -0.9 });
    shade(g, R, name + 'hi', ellipse(x + 0.2 * s, cy + 0.14 * s, 0.12 * s, 0.2 * s, 12, -0.4), PENCIL.green, 0.3);
  }
  pen(g, R, name + 'o', body, { close: true, w: 2.2 });
  face(g, R, name, x, cy + 0.04 * s, 0.7 * s, mood, 0.36);
}

// A birdhouse hanging from the bough on a string, with someone looking out.
// `y` is the bough's underside there.
function birdhouse(g, R, name, x, y, s, mood, colours) {
  const y0 = y + 0.6 * s;
  pen(g, R, name + 'string', [[x, y], [x + 2, y0]], { w: 1.6, wob: 1.4 });
  const body = [[x - 0.42 * s, y0 + 0.42 * s], [x + 0.42 * s, y0 + 0.42 * s], [x + 0.42 * s, y0 + 1.25 * s], [x - 0.42 * s, y0 + 1.25 * s]];
  pencil(g, R, name + 'bf', body, colours[0], { tone: 0.35, angle: 1.5, spacing: 3.4 });
  pen(g, R, name + 'bo', body, { close: true, w: 2.4 });
  for (let k = 1; k < 4; k++) pen(g, R, name + 'plank' + k, [[x - 0.42 * s + k * 0.21 * s, y0 + 0.46 * s], [x - 0.42 * s + k * 0.21 * s, y0 + 1.22 * s]], { w: 1.2, tone: 0.5 });
  const roof = [[x, y0], [x + 0.6 * s, y0 + 0.46 * s], [x - 0.6 * s, y0 + 0.46 * s]];
  pencil(g, R, name + 'rf', roof, colours[1], { tone: 0.5, angle: -0.4 });
  pen(g, R, name + 'ro', roof, { close: true, w: 2.2 });
  const hole = ellipse(x, y0 + 0.78 * s, 0.19 * s, 0.19 * s, 20);
  g.fillStyle = PAPER;
  path(g, hole);
  g.fill();
  pencil(g, R, name + 'hf', hole, PENCIL.cream, { tone: 0.3, spacing: 2.4, over: 1 });
  pen(g, R, name + 'ho', hole, { close: true, w: 2.2 });
  face(g, R, name, x, y0 + 0.78 * s, 0.6 * s, mood, 0.3);
  pen(g, R, name + 'perch', [[x - 0.02 * s, y0 + 1.02 * s], [x + 0.2 * s, y0 + 1.0 * s]], { w: 2.4, skip: 0 });
}

// A kite in two pencil colours with a face, its tail of bows trailing toward
// the margin on side `out`.
function kite(g, R, name, x, y, s, out, mood, colours) {
  const at = placed(x, y, s, (R(name, 'rot') - 0.5) * 0.5);
  const top = at(0, -0.6); const right = at(0.42, 0.02); const bottom = at(0, 0.6); const left = at(-0.42, 0.02);
  pencil(g, R, name + 'l', [top, left, bottom], colours[0], { tone: 0.5, angle: -0.8 });
  pencil(g, R, name + 'r', [top, right, bottom], colours[1], { tone: 0.5, angle: 0.6 });
  pen(g, R, name + 'o', [top, right, bottom, left], { close: true, w: 2.2 });
  pen(g, R, name + 'sv', [top, bottom], { w: 1.6, skip: 0.05 });
  pen(g, R, name + 'sh', [left, right], { w: 1.6, skip: 0.05 });
  face(g, R, name, x, y + 0.14 * s, 0.5 * s, mood, 0.36);
  const tail = chaikin([bottom, [bottom[0] + out * 20, bottom[1] + 55], [bottom[0] - out * 14, bottom[1] + 110], [bottom[0] + out * 28, bottom[1] + 165]], 2);
  pen(g, R, name + 'tail', tail, { w: 1.8 });
  for (let k = 0; k < 3; k++) {
    const [px, py] = tail[Math.round(((k + 1) / 3.2) * (tail.length - 1))];
    for (const d of [-1, 1]) {
      const bow = [[px, py], [px + d * 11, py - 7], [px + d * 12, py + 6]];
      pencil(g, R, name + 'bf' + k + d, bow, colours[k % 2], { tone: 0.5, spacing: 2.4, over: 1 });
      pen(g, R, name + 'bo' + k + d, bow, { close: true, w: 1.6, skip: 0 });
    }
  }
}

// A hot-air balloon: an envelope of gores in two pencil colours, a face on
// it, ropes and a wicker basket.
function balloon(g, R, name, cx, cy, s, mood, colours) {
  const hw = (y) => { const v = (y - cy) / (y < cy ? 0.62 * s : 0.66 * s); return 0.5 * s * Math.sqrt(Math.max(0, 1 - v * v)); };
  const gore = (u) => { const out = []; for (let y = cy - 0.6 * s; y <= cy + 0.6 * s; y += 6) out.push([cx + u * hw(y), y]); return out; };
  const envelope = [...arcPts(cx, cy, 0.5 * s, Math.PI, Math.PI * 2, 18, 0.62 * s), ...arcPts(cx, cy, 0.5 * s, 0, 1.22, 8, 0.66 * s), ...arcPts(cx, cy, 0.5 * s, 1.92, Math.PI, 8, 0.66 * s)];
  pencil(g, R, name + 'f', envelope, colours[0], { tone: 0.4, angle: -1.2 });
  for (const [k, [u0, u1]] of [[-0.6, -0.2], [0.2, 0.6]].entries()) pencil(g, R, name + 'g' + k, [...gore(u0), ...gore(u1).reverse()], colours[1], { tone: 0.45, angle: -1.3, over: 2 });
  for (const u of [-0.6, -0.2, 0.2, 0.6]) pen(g, R, name + 'gore' + u, gore(u), { w: 1.6, skip: 0.05 });
  pen(g, R, name + 'o', envelope, { close: true, w: 2.2 });
  face(g, R, name, cx, cy + 0.02 * s, 0.6 * s, mood, 0.36);
  const basket = [[cx - 0.16 * s, cy + 0.78 * s], [cx + 0.16 * s, cy + 0.78 * s], [cx + 0.13 * s, cy + 0.95 * s], [cx - 0.13 * s, cy + 0.95 * s]];
  for (const d of [-1, 1]) pen(g, R, name + 'rope' + d, [[cx + d * 0.15 * s, cy + 0.62 * s], [cx + d * 0.15 * s, cy + 0.78 * s]], { w: 1.4, skip: 0 });
  pencil(g, R, name + 'wf', basket, PENCIL.brown, { tone: 0.45, spacing: 2.4, over: 1, cross: true, angle: 0.5 });
  pen(g, R, name + 'wo', basket, { close: true, w: 2 });
}

// A ringed planet, the ring behind and in front of the disc.
function planet(g, R, name, x, y, s, mood) {
  const rot = -0.3;
  for (const k of [1, 0.78]) pen(g, R, name + 'back' + k, arcPts(x, y, 0.8 * s * k, Math.PI, Math.PI * 2, 18, 0.2 * s * k, rot), { ink: 'blue', w: 2, tone: 0.55 });
  const disc = ellipse(x, y, 0.42 * s, 0.42 * s, 32);
  g.fillStyle = PAPER;
  path(g, disc);
  g.fill();
  pencil(g, R, name + 'f', disc, PENCIL.lilac, { tone: 0.45, angle: -1.1, cross: true });
  shade(g, R, name + 'sh', ellipse(x + 0.14 * s, y + 0.16 * s, 0.22 * s, 0.14 * s, 16, 0.5), PENCIL.sky, 0.3);
  pen(g, R, name + 'o', disc, { close: true, ink: 'blue', w: 2.2 });
  for (const k of [1, 0.78]) pen(g, R, name + 'front' + k, arcPts(x, y, 0.8 * s * k, 0, Math.PI, 18, 0.2 * s * k, rot), { ink: 'blue', w: 2.2 });
  face(g, R, name, x, y - 0.04 * s, 0.6 * s, mood, 0.36);
}

// A feather the subject dropped, drifting down on a dotted path.
function feather(g, R, name, x, y, s, colour) {
  const rot = (R(name, 'rot') - 0.5) * 1.2;
  const at = placed(x, y, s, rot);
  const quill = resample(chaikin([at(0.02, -0.62), at(0.1, -0.2), at(-0.04, 0.2), at(0.06, 0.62)], 2), 4);
  const m = Math.round(quill.length * 0.72);
  const vane = ribbon(quill.slice(0, m), (i, n) => Math.max(0.02 * s, 0.2 * s * Math.sin((Math.PI * i) / (n - 1)) ** 0.7));
  pencil(g, R, name + 'f', vane, colour, { tone: 0.42, spacing: 2.8, over: 2, angle: rot + 0.9 });
  pen(g, R, name + 'o', vane, { close: true, w: 1.6, skip: 0.15 });
  for (let i = 3; i < m - 2; i += 3) {
    const [px, py] = quill[i]; const dx = quill[i + 1][0] - px; const dy = quill[i + 1][1] - py; const l = Math.hypot(dx, dy) || 1;
    const len = 0.17 * s * Math.sin((Math.PI * i) / (m - 1));
    for (const d of [-1, 1]) {
      const bx = (-dy / l) * d * 0.8 + (dx / l) * 0.6; const by = (dx / l) * d * 0.8 + (dy / l) * 0.6; const bl = Math.hypot(bx, by);
      pen(g, R, name + 'barb' + i + d, [[px, py], [px + (bx / bl) * len, py + (by / bl) * len]], { w: 1.1, tone: 0.55, skip: 0.25 });
    }
  }
  pen(g, R, name + 'q', quill, { w: 2, skip: 0.05 });
  pen(g, R, name + 'drift', chaikin([at(0.5, -1.3), at(0.2, -1.0), at(0.45, -0.75), at(0.1, -0.6)], 2), { w: 1.5, skip: 0.62, tone: 0.65 });
}

// A paper plane heading `a`, the loop it flew drawn as the pen skipping.
function plane(g, R, name, x, y, s, a) {
  const at = placed(x, y, s, a);
  const loop = [];
  for (let i = 0; i <= 40; i++) { const t = (i / 40) * Math.PI * 3.2; loop.push(at(-1.6 - Math.cos(t) * (1.1 - i * 0.012) - i * 0.02, 0.3 + Math.sin(t) * 0.7)); }
  pen(g, R, name + 'path', loop, { w: 1.6, skip: 0.62, tone: 0.7 });
  const body = [at(1, 0), at(-0.9, -0.5), at(-0.6, 0), at(-0.9, 0.45)];
  pencil(g, R, name + 'f', body, PENCIL.cream, { tone: 0.3, spacing: 2.6, over: 2 });
  pen(g, R, name + 'o', body, { close: true, w: 2, skip: 0.05 });
  pen(g, R, name + 'fold', [at(1, 0), at(-0.6, 0)], { w: 1.4, skip: 0 });
  pen(g, R, name + 'keel', [at(0.2, 0), at(-0.8, 0.3)], { w: 1.4, skip: 0 });
}

// A teacup on its saucer, steaming, with a face.
function teacup(g, R, name, x, y, s, mood, colour) {
  const saucer = ellipse(x, y + 0.34 * s, 0.62 * s, 0.1 * s, 24);
  pencil(g, R, name + 'sf', saucer, PENCIL.grey, { tone: 0.2, spacing: 3, over: 1 });
  pen(g, R, name + 'so', saucer, { close: true, w: 2 });
  const cup = chaikin([[x - 0.42 * s, y - 0.3 * s], [x + 0.42 * s, y - 0.3 * s], [x + 0.36 * s, y + 0.18 * s], [x + 0.2 * s, y + 0.3 * s], [x - 0.2 * s, y + 0.3 * s], [x - 0.36 * s, y + 0.18 * s]], 1, true);
  g.fillStyle = PAPER;
  path(g, cup);
  g.fill();
  pencil(g, R, name + 'f', cup, colour, { tone: 0.4, angle: -1.2 });
  shade(g, R, name + 'band', [[x - 0.41 * s, y - 0.12 * s], [x + 0.41 * s, y - 0.12 * s], [x + 0.4 * s, y - 0.02 * s], [x - 0.4 * s, y - 0.02 * s]], PENCIL.blue, 0.35);
  pen(g, R, name + 'o', cup, { close: true, w: 2.4 });
  pen(g, R, name + 'rim', ellipse(x, y - 0.3 * s, 0.42 * s, 0.07 * s, 20), { close: true, w: 2, skip: 0.05 });
  pen(g, R, name + 'handle', arcPts(x + 0.44 * s, y - 0.02 * s, 0.16 * s, -Math.PI / 2, Math.PI / 2, 8, 0.2 * s), { w: 2.4, skip: 0.05 });
  for (const d of [-1, 1]) pen(g, R, name + 'steam' + d, chaikin([[x + d * 0.14 * s, y - 0.42 * s], [x + d * 0.24 * s, y - 0.56 * s], [x + d * 0.08 * s, y - 0.72 * s], [x + d * 0.2 * s, y - 0.9 * s]], 2), { w: 1.6, skip: 0.3, tone: 0.6 });
  face(g, R, name, x, y + 0.04 * s, 0.6 * s, mood, 0.4);
}

// A caterpillar on a leaf, each segment a pencil disc, the head with a face.
function caterpillar(g, R, name, x, y, s) {
  const bed = ellipse(x, y + 0.1 * s, 0.8 * s, 0.3 * s, 24, 0.12);
  pencil(g, R, name + 'bf', bed, PENCIL.green, { tone: 0.4, spacing: 3 });
  pen(g, R, name + 'bo', bed, { close: true, w: 2.2 });
  pen(g, R, name + 'vein', [[x - 0.7 * s, y + 0.18 * s], [x + 0.7 * s, y + 0.02 * s]], { w: 1.4, skip: 0 });
  for (let k = 0; k < 5; k++) {
    const sx = x - 0.5 * s + k * 0.22 * s; const sy = y - 0.12 * s - Math.sin((k / 4) * Math.PI) * 0.08 * s; const r = k === 4 ? 0.16 * s : 0.13 * s;
    for (const d of [-1, 1]) pen(g, R, name + 'foot' + k + d, [[sx + d * 0.04 * s, sy + r * 0.8], [sx + d * 0.07 * s, sy + r + 0.05 * s]], { w: 1.4, skip: 0 });
    const seg = ellipse(sx, sy, r, r, 16);
    g.fillStyle = PAPER;
    path(g, seg);
    g.fill();
    pencil(g, R, name + 'sf' + k, seg, k % 2 ? PENCIL.yellow : PENCIL.green, { tone: 0.5, spacing: 2.4, over: 2 });
    pen(g, R, name + 'so' + k, seg, { close: true, w: 2, skip: 0.05 });
    if (k === 4) {
      for (const d of [-1, 1]) pen(g, R, name + 'ant' + d, [[sx + d * 0.05 * s, sy - r], [sx + d * 0.12 * s, sy - r - 0.14 * s]], { w: 1.2, skip: 0 });
      face(g, R, name, sx, sy, 0.5 * s, 'happy', 0.36);
    }
  }
}

// Two acorns side by side, caps cross-hatched, with a small heart between.
function acorns(g, R, name, x, y, s, moods) {
  for (const [k, d] of [-1, 1].entries()) {
    const ax = x + d * 0.34 * s;
    const body = ellipse(ax, y + 0.1 * s, 0.26 * s, 0.32 * s, 20);
    pencil(g, R, name + 'bf' + k, body, PENCIL.cream, { tone: 0.45, spacing: 2.6, over: 2 });
    pen(g, R, name + 'bo' + k, body, { close: true, w: 2.2 });
    const cap = [...arcPts(ax, y - 0.08 * s, 0.32 * s, Math.PI, Math.PI * 2, 12, 0.24 * s), [ax + 0.32 * s, y + 0.02 * s], [ax - 0.32 * s, y + 0.02 * s]];
    g.fillStyle = PAPER;
    path(g, cap);
    g.fill();
    pencil(g, R, name + 'cf' + k, cap, PENCIL.brown, { tone: 0.5, spacing: 2.4, over: 2, cross: true, angle: 0.6 });
    pen(g, R, name + 'co' + k, cap, { close: true, w: 2.2 });
    pen(g, R, name + 'stalk' + k, [[ax, y - 0.3 * s], [ax + d * 0.06 * s, y - 0.46 * s]], { w: 2, skip: 0 });
    face(g, R, name + k, ax, y + 0.14 * s, 0.6 * s, moods[k], 0.36);
  }
  const h = heart(x, y - 0.26 * s, 0.4);
  shade(g, R, name + 'hf', h, PENCIL.pink, 0.45);
  pen(g, R, name + 'ho', h, { close: true, w: 1.6, ink: 'red', skip: 0 });
}

// A quaver in the blue pen, its head filled.
function note(g, R, name, x, y, s) {
  const head = ellipse(x, y, 0.3 * s, 0.22 * s, 14, -0.5);
  g.fillStyle = rgba(INK.blue, 0.9);
  path(g, head);
  g.fill();
  pen(g, R, name + 'h', head, { close: true, ink: 'blue', w: 1.8, skip: 0 });
  const sx = x + 0.26 * s;
  pen(g, R, name + 's', [[sx, y - 0.1 * s], [sx, y - 1.1 * s]], { ink: 'blue', w: 1.8, skip: 0 });
  pen(g, R, name + 'flag', [[sx, y - 1.1 * s], [sx + 0.3 * s, y - 0.8 * s], [sx + 0.2 * s, y - 0.45 * s]], { ink: 'blue', w: 1.6, skip: 0 });
}

// A bow on the subject's head: two loops, a knot and two tails.
function bow(g, R, name, x, y, s, colour) {
  for (const d of [-1, 1]) {
    const loop = ellipse(x + d * 0.3 * s, y - 0.08 * s, 0.3 * s, 0.17 * s, 14, d * -0.35);
    pencil(g, R, name + 'lf' + d, loop, colour, { tone: 0.5, spacing: 2.4, over: 2 });
    pen(g, R, name + 'lo' + d, loop, { close: true, w: 1.8, skip: 0 });
    pen(g, R, name + 'tail' + d, [[x, y + 0.05 * s], [x + d * 0.25 * s, y + 0.4 * s]], { w: 1.6, skip: 0 });
  }
  dot(g, x, y, 0.09 * s);
}

// The title in a ribbon banner: swallow-tailed ends behind a panel, the
// letters in two pens on it.
function banner(g, R, name, word, cx, cy) {
  const size = 44; const tw = font.width(word, size); const w = tw + 60; const h = size + 30;
  const x0 = cx - w / 2; const x1 = cx + w / 2; const y0 = cy - h / 2; const y1 = cy + h / 2;
  for (const [d, xe] of [[-1, x0], [1, x1]]) {
    const tail = [[xe - d * 14, y0 + 10], [xe + d * 36, y0 + 4], [xe + d * 22, cy], [xe + d * 36, y1 - 4], [xe - d * 14, y1 - 10]];
    pencil(g, R, name + 'tf' + d, tail, PENCIL.yellow, { tone: 0.45, angle: -0.6, spacing: 3 });
    pen(g, R, name + 'to' + d, tail, { close: true, w: 2.2 });
  }
  const panel = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  g.fillStyle = PAPER;
  path(g, panel);
  g.fill();
  pencil(g, R, name + 'pf', panel, PENCIL.cream, { tone: 0.22, spacing: 4, over: 1 });
  pen(g, R, name + 'po', panel, { close: true, w: 2.2 });
  letter(g, R, name + 'w', word, cx - tw / 2, cy - size / 2, size, ['red', 'blue'], 2.4);
}

const SCHEMES = [
  { body: PENCIL.orange, belly: PENCIL.yellow, wing: PENCIL.red, tail: PENCIL.red, beak: PENCIL.yellow },
  { body: PENCIL.sky, belly: PENCIL.cream, wing: PENCIL.blue, tail: PENCIL.blue, beak: PENCIL.orange },
  { body: PENCIL.green, belly: PENCIL.yellow, wing: PENCIL.green, tail: PENCIL.brown, beak: PENCIL.orange },
  { body: PENCIL.lilac, belly: PENCIL.pink, wing: PENCIL.blue, tail: PENCIL.lilac, beak: PENCIL.yellow },
];
const MOODS = ['happy', 'sleep', 'oh', 'cat'];
const PAIRS = [[PENCIL.red, PENCIL.yellow], [PENCIL.sky, PENCIL.orange], [PENCIL.lilac, PENCIL.green], [PENCIL.pink, PENCIL.blue]];

function draw(g, s) {
  const R = rng(s.seed);
  const pick = (name, list) => list[Math.floor(R(name, 'pick') * list.length) % list.length];
  // Every placed thing claims a disc; nothing else is drawn inside one.
  const taken = [];
  const free = (x, y, r) => taken.every(([tx, ty, tr]) => Math.hypot(x - tx, y - ty) > r + tr);
  const claim = (x, y, r) => taken.push([x, y, r]);
  // The first candidate spot with room, or null.
  const spot = (r, candidates) => candidates.find(([x, y]) => free(x, y, r)) || null;
  paper(g, R, W, H);

  // The bough enters from one side and thins to its tip on the other.
  const side = R('cast', 'side') < 0.5 ? 1 : -1;
  const mx = (x) => (side > 0 ? x : W - x);
  const by = 560 + R('bough', 'y') * 30;
  const spine = resample(chaikin([[mx(-20), by + 36], [mx(150), by + 24], [mx(330), by + 12], [mx(520), by + 4], [mx(700), by - 14], [mx(860), by - 36], [mx(905), by - 44]], 2), 6);
  const n = spine.length;
  const near = (x) => { let k = 0; for (let i = 1; i < n; i++) if (Math.abs(spine[i][0] - x) < Math.abs(spine[k][0] - x)) k = i; return k; };
  const top = (x) => spine[near(x)][1] - (12 - 8 * (near(x) / (n - 1)));
  const under = (x) => spine[near(x)][1] + (12 - 8 * (near(x) / (n - 1)));
  bough(g, R, 'bough', spine);

  // The subject: pencil fills, then the pen over them, then its face.
  const scheme = pick('scheme', SCHEMES);
  const flip = R('bird', 'flip') < 0.5; const f = flip ? -1 : 1;
  const b = bird(500, by - 118, 190, -0.05 * f, flip);
  claim(500, by - 110, 215);
  for (const [i, leg] of b.legs.entries()) pen(g, R, 'leg' + i, [leg[0], [leg[1][0], top(leg[1][0]) + 2 - i * 5]], { w: 2.2 });
  // The pencil's spacing on the subject's fills: 3.3 is the pencil's own.
  const spacing = (s.params && s.params.spacing) ?? 3.3;
  pencil(g, R, 'tailf', b.tail, scheme.tail, { tone: 0.5, angle: -0.5, spacing });
  pen(g, R, 'tail', b.tail, { close: true, w: 2.2 });
  pencil(g, R, 'bodyf', b.body, scheme.body, { tone: 0.42, angle: -1.0, spacing });
  pencil(g, R, 'bellyf', b.at(ellipse(-0.05, 0.22, 0.6, 0.26, 24, 0.1)), scheme.belly, { tone: 0.5, angle: -0.3, over: 3, within: b.body, spacing });
  pencil(g, R, 'shadef', b.at(ellipse(-0.25, 0.3, 0.34, 0.13, 20, 0.2)), scheme.wing, { tone: 0.16, angle: 0.4, over: 2, within: b.body, spacing });
  pen(g, R, 'body', b.body, { close: true, w: 2.4 });
  g.fillStyle = PAPER;
  path(g, b.wing);
  g.fill();
  pencil(g, R, 'wingf', b.wing, scheme.wing, { tone: 0.48, angle: -0.8, spacing });
  pen(g, R, 'wing', b.wing, { close: true, w: 2.2 });
  for (let k = 0; k < 3; k++) pen(g, R, 'scallop' + k, chaikin(b.at([[0.1 - k * 0.22, -0.08], [-0.02 - k * 0.22, 0.03], [-0.14 - k * 0.22, -0.06]]), 2), { w: 1.8 });
  pencil(g, R, 'beakf', b.beak, scheme.beak, { tone: 0.6, spacing: 2.6, over: 2 });
  pen(g, R, 'beak', b.beak, { close: true, w: 2 });
  face(g, R, 'birdface', b.eye[0] - f * b.s * 0.1, b.eye[1] + b.s * 0.04, b.s * 0.9, pick('birdmood', ['happy', 'sleep']), 0.3, false);
  if (R('bird', 'bow') < 0.6) {
    const [hx, hy] = b.at([[0.36, -0.7]])[0];
    bow(g, R, 'bow', hx, hy, b.s * 0.26, pick('bowc', [PENCIL.red, PENCIL.pink, PENCIL.yellow]));
  }

  // What it sings: quavers from the beak, then the word in the blue pen.
  const tip = b.at([[1.02, -0.4]])[0];
  const song = pick('song', ['TWEET', 'LA LA', 'HELLO', 'CHIRP']);
  const sw = font.width(song, 22); const sx = f > 0 ? tip[0] + 70 : tip[0] - 70 - sw;
  letter(g, R, 'tweet', song, sx, tip[1] - 50, 22, ['blue'], 1.8);
  claim(sx + sw / 2, tip[1] - 38, sw / 2 + 12);
  for (let k = 0; k < 2 + Math.floor(R('notes', 'n') * 2); k++) {
    const ns = 18 + R('notes', 's', k) * 6; const nx = tip[0] + f * (12 + k * 16); const ny = tip[1] - 2 - k * 14;
    note(g, R, 'note' + k, nx, ny, ns);
    claim(nx + 0.2 * ns, ny - 0.5 * ns, 0.75 * ns);
  }

  // On the bough: the nest at its tip, a ladybird, and leaves where there is room.
  const tipX = mx(860);
  nest(g, R, 'nest', tipX, top(tipX), 100, [pick('egg1', ['sleep', 'oh', 'happy']), pick('egg2', ['sleep', 'cat'])]);
  claim(tipX, top(tipX) - 26, 50);
  const lbX = mx(745);
  ladybird(g, R, 'ladybird', lbX, top(lbX), 36, R('ladybird', 'dir') < 0.5 ? side : -side);
  claim(lbX, top(lbX) - 14, 24);
  let leaves = 0;
  for (const [i, x] of [60, 170, 270, 640, 730, 800, 880].map(mx).entries()) {
    if (leaves === 5 || !free(x, top(x) - 24, 28)) continue;
    const a = -Math.PI / 2 + (R('leaf', 'a', i) - 0.5) * 1.6;
    leaf(g, R, 'leaf' + i, x + Math.cos(a) * 22, top(x) + Math.sin(a) * 22, 24, a);
    claim(x + Math.cos(a) * 22, top(x) + Math.sin(a) * 22, 26);
    leaves++;
  }

  // Hanging from it: fruit and a birdhouse with someone at home.
  const kind = pick('fruit', ['apple', 'pear']);
  for (const [k, x] of [110, 690, 790].map(mx).entries()) {
    if (k === 2 && R('fruit', 'third') < 0.5) continue;
    fruit(g, R, 'fruit' + k, x, under(x), 72, kind, pick('fruitmood' + k, MOODS));
    claim(x, under(x) + 54, 40);
  }
  const hx = mx(290);
  birdhouse(g, R, 'house', hx, under(hx), 100, pick('housemood', ['oh', 'happy', 'sleep']), pick('housec', PAIRS));
  claim(hx, under(hx) + 140, 85);
  for (let i = 0; i < n; i += 8) claim(spine[i][0], spine[i][1], 18);

  // The title: a banner at the top or the foot, by seed.
  const word = pick('word', ['GOOD MORNING', 'SING ALONG', 'HELLO THERE', 'NICE DAY']);
  const atTop = R('cast', 'banner') < 0.5;
  const tw = font.width(word, 44) + 60;
  banner(g, R, 'title', word, 500, atTop ? 76 : 880);
  for (let x = 500 - tw / 2; x <= 500 + tw / 2; x += 40) claim(x, atTop ? 76 : 880, 48);
  // The swallow tails reach 36 past each end of the panel.
  for (const d of [-1, 1]) claim(500 + d * (tw / 2 + 22), atTop ? 76 : 880, 38);

  // The top corners: a kite, and a balloon or a planet, whichever corner is free.
  const cy = atTop ? 190 : 165;
  const corners = R('cast', 'kiteleft') < 0.5 ? [[150, cy], [850, cy], [150, cy + 40], [850, cy + 40]] : [[850, cy], [150, cy], [850, cy + 40], [150, cy + 40]];
  const kiteAt = corners.find(([x, y]) => free(x, y, 72) && free(x, y + 120, 40) && free(x, y + 200, 40)) || null;
  if (kiteAt) {
    const out = kiteAt[0] < 500 ? -1 : 1;
    kite(g, R, 'kite', kiteAt[0], kiteAt[1], 100, out, pick('kitemood', MOODS), pick('kitec', PAIRS));
    claim(kiteAt[0], kiteAt[1], 72);
    claim(kiteAt[0] + out * 6, kiteAt[1] + 120, 40);
    claim(kiteAt[0] + out * 10, kiteAt[1] + 200, 40);
  }
  const skyAt = spot(85, corners);
  if (skyAt) {
    if (R('cast', 'sky') < 0.5) balloon(g, R, 'balloon', skyAt[0], skyAt[1] - 20, 100, pick('balloonmood', MOODS), pick('balloonc', PAIRS));
    else planet(g, R, 'planet', skyAt[0], skyAt[1], 100, pick('planetmood', ['sleep', 'sleep', 'happy', 'oh']));
    claim(skyAt[0], skyAt[1], 85);
  }

  // The side margins: a fallen feather in the subject's wing colour, with
  // the drift it fell by above it, and a paper plane.
  const fDrift = ([x, y]) => placed(x, y, 70, (R('feather', 'rot') - 0.5) * 1.2)(0.3, -0.95);
  const fAt = [[mx(890), 400], [mx(110), 470], [mx(110), 400], [mx(890), 470], [mx(890), 330], [mx(110), 330], [mx(60), 440], [mx(940), 440]].find((p) => free(p[0], p[1], 54) && free(...fDrift(p), 34)) || null;
  if (fAt) {
    feather(g, R, 'feather', fAt[0], fAt[1], 70, scheme.wing);
    claim(fAt[0], fAt[1], 54);
    claim(...fDrift(fAt), 34);
  }
  // The plane flies toward the centre; its loop, behind it, needs room too.
  const pAt = [[mx(200), 470], [mx(200), 410], [mx(800), 470], [mx(800), 410], [mx(200), 340], [mx(800), 340]].find(([x, y]) => free(x, y, 52) && free(x - (x < 500 ? 70 : -70), y + 25, 60)) || null;
  if (pAt) {
    const d = pAt[0] < 500 ? 1 : -1;
    plane(g, R, 'plane', pAt[0], pAt[1], 46, d > 0 ? -0.45 : Math.PI + 0.45);
    claim(pAt[0], pAt[1], 52);
    claim(pAt[0] - d * 70, pAt[1] + 25, 60);
  }

  // The foot: a teacup, a caterpillar and two acorns take the free spots.
  const foot = [[mx(140), 855], [500, 855], [mx(860), 855]];
  const order = R('cast', 'foot') < 0.5 ? [0, 1, 2] : [2, 0, 1];
  const cupAt = spot(72, order.map((i) => foot[i]));
  if (cupAt) {
    teacup(g, R, 'teacup', cupAt[0], cupAt[1] - 10, 90, pick('cupmood', MOODS), pick('cupc', [PENCIL.pink, PENCIL.sky, PENCIL.orange]));
    claim(cupAt[0], cupAt[1] - 20, 72);
  }
  const catAt = spot(80, order.map((i) => foot[i]));
  if (catAt) {
    caterpillar(g, R, 'caterpillar', catAt[0], catAt[1], 90);
    claim(catAt[0], catAt[1], 80);
  }
  const acAt = spot(66, order.map((i) => foot[i]));
  if (acAt) {
    acorns(g, R, 'acorns', acAt[0], acAt[1] + 6, 80, [pick('acorn1', MOODS), pick('acorn2', ['happy', 'cat'])]);
    claim(acAt[0], acAt[1], 66);
  }

  // Small things in the margins, wherever room is left: stars, hearts,
  // sparkles, spirals and crosses. The caption's line is claimed first.
  for (let x = 48; x <= 40 + font.width('PEN AND PENCIL', 14); x += 24) claim(x, 959, 22);
  for (let k = 0; k < 22; k++) {
    const x = 30 + R('doodle', 'x', k) * 940; const y = 30 + R('doodle', 'y', k) * 940;
    if (!free(x, y, 26)) continue;
    claim(x, y, 22);
    const what = pick('doodle' + k, ['star', 'heart', 'sparkle', 'spiral', 'cross']);
    if (what === 'star') {
      const pts = star(x, y, 8 + R('doodle', 'r', k) * 6, 5, 0.45);
      if (R('doodle', 'fill', k) < 0.5) pencil(g, R, 'starf' + k, pts, PENCIL.yellow, { tone: 0.5, spacing: 2.4, over: 2 });
      pen(g, R, 'star' + k, pts, { close: true, w: 1.8, ink: k % 2 ? 'blue' : 'brown' });
    } else if (what === 'heart') {
      const h = heart(x, y, 0.45 + R('doodle', 'r', k) * 0.25);
      shade(g, R, 'heartf' + k, h, PENCIL.pink, 0.45);
      pen(g, R, 'heart' + k, h, { close: true, w: 1.8, ink: 'red' });
    } else if (what === 'sparkle') {
      pen(g, R, 'sparkv' + k, [[x, y - 11], [x, y + 11]], { w: 1.6, skip: 0 });
      pen(g, R, 'sparkh' + k, [[x - 11, y], [x + 11, y]], { w: 1.6, skip: 0 });
      pen(g, R, 'sparkd' + k, [[x - 5, y - 5], [x + 5, y + 5]], { w: 1.2, skip: 0 });
      pen(g, R, 'sparke' + k, [[x + 5, y - 5], [x - 5, y + 5]], { w: 1.2, skip: 0 });
    } else if (what === 'spiral') {
      const pts = [];
      for (let i = 0; i <= 30; i++) { const a = (i / 30) * Math.PI * 4; const r = 2 + i * 0.4; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
      pen(g, R, 'spiral' + k, pts, { w: 1.5, ink: 'blue' });
    } else {
      pen(g, R, 'crossa' + k, [[x - 6, y - 6], [x + 6, y + 6]], { w: 1.6, ink: 'blue', skip: 0 });
      pen(g, R, 'crossb' + k, [[x + 6, y - 6], [x - 6, y + 6]], { w: 1.6, ink: 'blue', skip: 0 });
    }
  }

  caption(g, 'PEN AND PENCIL', font, rgba(INK.brown, 0.8), 40, 952);
}

const params = {
  spacing: { min: 2.1, max: 4.5, value: 3.3, meaning: 'Gap between the pencil strokes that colour the bird: dense, nearly solid fills to open hatching' },
};

module.exports = { name: 'pen-and-pencil', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
