// Watercolour: transparent washes on cold-press paper. Each wash is one shape
// painted as dozens of faint, slightly different layers, so its edge is soft
// in some places and ragged in others; washes glaze over each other by
// multiplying, pigment gathers at their rims and settles in the paper's
// tooth, and the white of the paper is the only white.

'use strict';

const { rng, fbm } = require('../../../core/rand.js');
const { chaikin, pointInPoly, bbox, centroid } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, wobble, ellipse, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const P = {
  paper: '#f8f4ea',
  cerulean: '#5b9fcc',
  ultramarine: '#3e55a8',
  rose: '#dc6f86',
  peach: '#f2b27a',
  ochre: '#dcaa4a',
  sienna: '#b9602f',
  umber: '#5e3d27',
  sap: '#7aa13f',
  hooker: '#3b7650',
  payne: '#2d3642',
  graphite: 'rgba(80, 76, 72, 0.4)',
};

function gauss(R, name, i) {
  const u = Math.max(1e-9, R(name, 'u', i));
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R(name, 'v', i));
}

// Midpoint displacement of a closed outline. Each point carries its own
// roughness, handed on to the points made beside it, so one stretch of an
// edge stays crisp while another frays.
function deform(pts, R, name, depth, amount) {
  let cur = pts;
  let n = 0;
  for (let d = 0; d < depth; d++) {
    const out = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]; const b = cur[(i + 1) % cur.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const r = (a[2] + b[2]) / 2;
      out.push(a, [
        (a[0] + b[0]) / 2 + gauss(R, name + 'x', n) * len * amount * r,
        (a[1] + b[1]) / 2 + gauss(R, name + 'y', n) * len * amount * r,
        Math.min(1.6, Math.max(0.2, r * (0.65 + 0.7 * R(name, 'r', n)))),
      ]);
      n++;
    }
    cur = out;
  }
  return cur;
}

// One wash: an outline deformed once, then painted as `layers` faint
// variations of it. Multiply makes every layer a glaze over what is below.
// Each layer passes only where a noise field is above that layer's level,
// so pigment pools where the field is high and thins where it is low; a
// second colour, when given, flows into some layers, as wet paint dropped
// into a wet wash. Pigment then gathers inside the rim where the wash dried.
// `outline` may be a function of the layer, for a wash graded from one side.
function wash(g, R, name, outline, colour, opts = {}) {
  const { layers = 24, alpha = 0.03, rough = 1, spread = 0.12, rim = 0.05, second = null, share = 0.35, mottle = 0.6 } = opts;
  const prep = (pts, key) => deform(pts.map((p, i) => [p[0], p[1], rough * (0.3 + 1.4 * R(name, 'rough' + key, i))]), R, name + 'b' + key, 2, spread);
  const fixed = typeof outline === 'function' ? null : prep(outline, '');
  const [x0, y0, x1, y1] = bbox(fixed || prep(outline(1), 'box'));
  const size = Math.max(x1 - x0, y1 - y0, 1);
  const cell = Math.max(6, Math.min(26, size / 16));
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.lineJoin = 'round';
  for (let k = 0; k < layers; k++) {
    const base = fixed || prep(outline(k / Math.max(1, layers - 1)), k);
    const layer = deform(base, R, name + 'l' + k, 3, spread * 0.45);
    const ink = second && R(name, 'mix', k) < share ? second : colour;
    g.save();
    if (mottle > 0) {
      const level = 0.5 + mottle * 0.6 * (k / Math.max(1, layers - 1) - 0.5);
      g.beginPath();
      for (let y = y0 - cell; y < y1 + cell; y += cell) {
        for (let x = x0 - cell; x < x1 + cell; x += cell) {
          const jx = x + (R(name, 'jx' + k, Math.round(x * 7 + y)) - 0.5) * cell;
          const jy = y + (R(name, 'jy' + k, Math.round(x * 7 + y)) - 0.5) * cell;
          if (fbm(R, jx / (size * 0.45), jy / (size * 0.45), 3, name + 'pool') < level) continue;
          g.moveTo(jx + cell * 0.95, jy);
          g.arc(jx, jy, cell * 0.95, 0, Math.PI * 2);
        }
      }
      g.clip();
    }
    g.fillStyle = ink;
    g.globalAlpha = alpha * (1 + mottle);
    path(g, layer);
    g.fill();
    g.restore();
  }
  const edge = fixed || prep(outline(0), 'r');
  if (rim > 0 && (fixed || opts.rim)) {
    g.save();
    path(g, edge);
    g.clip();
    g.strokeStyle = colour;
    g.globalAlpha = rim;
    g.lineWidth = 7;
    path(g, edge);
    g.stroke();
    g.globalAlpha = rim * 1.6;
    g.lineWidth = 2;
    path(g, edge);
    g.stroke();
    g.restore();
  }
  g.restore();
  return edge;
}

// Pigment lifted with a damp brush: the paper shows again, softly.
// Each pass is a little smaller, so the lift is strongest at its middle.
function lift(g, R, name, outline, strength = 0.5) {
  const [cx, cy] = centroid(outline);
  g.save();
  g.fillStyle = P.paper;
  for (let k = 0; k < 12; k++) {
    const s = 1.35 - (0.8 * k) / 11;
    const pts = outline.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s, 1]);
    g.globalAlpha = strength / 12;
    path(g, deform(pts, R, name + 'l' + k, 3, 0.1));
    g.fill();
  }
  g.restore();
}

// Pigment settled in the paper's tooth: specks, clumped by a noise field,
// inside a shape.
function granulate(g, R, name, shape, colour, count, size = 1.5) {
  const [x0, y0, x1, y1] = bbox(shape);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour;
  for (let i = 0; i < count; i++) {
    const x = x0 + R(name, 'gx', i) * (x1 - x0); const y = y0 + R(name, 'gy', i) * (y1 - y0);
    if (fbm(R, x / 30, y / 30, 3, name + 'clump') < 0.55 || !pointInPoly([x, y], shape)) continue;
    g.globalAlpha = 0.12 + 0.22 * R(name, 'ga', i);
    const r = size * (0.5 + R(name, 'gr', i));
    g.fillRect(x - r / 2, y - r / 2, r, r);
  }
  g.restore();
}

function splatter(g, R, name, x, y, spread, colour, n) {
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour;
  for (let i = 0; i < n; i++) {
    const a = R(name, 'a', i) * Math.PI * 2; const d = spread * Math.sqrt(R(name, 'd', i));
    const r = 1 + 5 * R(name, 'r', i) ** 3;
    g.globalAlpha = 0.25 + 0.3 * R(name, 'k', i);
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// A loose graphite line left from the underdrawing, lifting now and then.
function pencil(g, R, name, pts, close = false) {
  g.save();
  g.strokeStyle = P.graphite;
  g.lineWidth = 1.2;
  g.lineCap = 'round';
  const line = wobble(pts, R, name, 1.4, 9, close);
  g.beginPath();
  let pen = false;
  for (let i = 0; i < line.length; i++) {
    const gap = R(name, 'gap', i) < 0.06;
    if (gap || !pen) g.moveTo(line[i][0], line[i][1]); else g.lineTo(line[i][0], line[i][1]);
    pen = !gap;
  }
  g.stroke();
  g.restore();
}

// The paper's tooth: the lit side of each bump catches no paint.
function tooth(g, R) {
  g.save();
  for (let i = 0; i < 9000; i++) {
    const x = R('tooth', 'x', i) * W; const y = R('tooth', 'y', i) * H;
    const k = 0.6 + R('tooth', 'k', i) * 1.2;
    g.fillStyle = R('tooth', 'tone', i) < 0.55 ? 'rgba(255, 254, 250, 0.28)' : 'rgba(110, 90, 60, 0.05)';
    g.fillRect(x, y, k, k);
  }
  g.restore();
}

function blob(cx, cy, rx, ry, n = 24, rot = 0) {
  return ellipse(cx, cy, rx, ry, n, rot);
}

function leaf(cx, cy, len, wide, angle) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8; pts.push([(t - 0.5) * len, Math.sin(t * Math.PI) * wide * (1 - 0.3 * t)]);
  }
  for (let i = 7; i > 0; i--) pts.push([pts[i][0], -pts[i][1]]);
  const c = Math.cos(angle); const s = Math.sin(angle);
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

function draw(g, s) {
  const R = rng(s.seed);

  g.fillStyle = P.paper;
  g.fillRect(0, 0, W, H);

  // Sky: a wash graded down from the top. Every layer reaches a different
  // depth, so the colour thins to bare paper; ultramarine flows into it.
  const sky = wash(g, R, 'sky', (u) => blob(430 + 60 * u, 90 + 40 * R('sky', 'top', Math.round(u * 99)) + 40 + 110 * u, 380 + 40 * u, 40 + 110 * u, 30), P.cerulean,
    { layers: 30, alpha: 0.022, spread: 0.13, second: P.ultramarine, share: 0.25, mottle: 0 });
  granulate(g, R, 'skyg', sky, P.ultramarine, 1600, 1.3);
  // A bloom: water crept back into the drying sky, pushed the pigment out
  // and left it as a ragged dark edge round a paler middle.
  const bloom = deform(blob(690, 190, 70, 48, 20).map((p) => [p[0], p[1], 1.3]), R, 'bloom', 3, 0.16);
  lift(g, R, 'bloomlift', bloom, 0.45);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.strokeStyle = P.ultramarine;
  g.lineJoin = 'round';
  for (let k = 0; k < 3; k++) {
    g.globalAlpha = 0.1;
    g.lineWidth = 1 + k * 0.6;
    path(g, deform(bloom, R, 'bloomedge' + k, 2, 0.06));
    g.stroke();
  }
  g.restore();

  // Loose foliage behind the branch, wet into wet, and a ground wash that
  // fades out before the edge of the sheet.
  wash(g, R, 'bush', blob(810, 650, 190, 125, 28, -0.2), P.sap, { layers: 16, alpha: 0.03, spread: 0.14, second: P.ochre, share: 0.4, mottle: 0.8 });
  // Darker glazes laid once the first wash had dried: hard edges.
  wash(g, R, 'bushd', blob(880, 700, 105, 80, 22), P.hooker, { layers: 10, alpha: 0.035, spread: 0.14, second: P.ultramarine, share: 0.25, mottle: 0.8, rim: 0.08 });
  wash(g, R, 'bushm', blob(730, 610, 70, 50, 18, 0.4), P.sap, { layers: 8, alpha: 0.035, spread: 0.16, second: P.hooker, share: 0.5, mottle: 0.8, rim: 0.08 });
  wash(g, R, 'ground', (u) => blob(480, 790, 360 - 120 * u, 40 + 30 * u, 30, 0.03), P.sap, { layers: 18, alpha: 0.022, spread: 0.14, second: P.ochre, share: 0.4 });
  // Grass flicked up from the ground with the brush's tip.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = 200 + R('grass', 'x', i) * 520; const y = 790 + (R('grass', 'y', i) - 0.5) * 50;
    const h = 30 + 60 * R('grass', 'h', i); const lean = (R('grass', 'l', i) - 0.4) * 40;
    const w = 2 + 2.5 * R('grass', 'w', i);
    // A pressed stroke lifting off: wide at the root, a point at the tip.
    const left = []; const right = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const px = x + lean * t * t; const py = y - h * t; const half = (w / 2) * (1 - t);
      left.push([px - half, py]);
      right.push([px + half, py]);
    }
    g.fillStyle = R('grass', 'c', i) < 0.6 ? P.sap : P.hooker;
    g.globalAlpha = 0.3 + 0.35 * R('grass', 'a', i);
    path(g, [...left, ...right.reverse()]);
    g.fill();
  }
  g.restore();

  // The branch: dragged with a loaded brush, heavier at the base.
  const smooth = chaikin([[980, 588], [840, 612], [680, 640], [520, 656], [380, 664], [300, 660]], 3);
  const thick = (i) => 3 + 11 * (1 - i / smooth.length) ** 1.3;
  const limb = [...smooth.map(([x, y], i) => [x, y - thick(i)]), ...smooth.map(([x, y], i) => [x, y + thick(i) * 0.8]).reverse()];
  pencil(g, R, 'branchp', smooth);
  wash(g, R, 'limb', limb, P.sienna, { layers: 10, alpha: 0.08, spread: 0.05, rim: 0.12, second: P.umber, share: 0.6, mottle: 0.7 });
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.strokeStyle = P.umber;
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    g.globalAlpha = 0.35;
    g.lineWidth = 2.2;
    const off = (k - 1) * 4;
    const line = wobble(smooth.map(([x, y]) => [x, y + off]), R, 'dry' + k, 1.2, 8);
    g.beginPath();
    for (let i = 1; i < line.length; i++) {
      if (R('dry' + k, 'skip', i) < 0.35) continue;
      g.moveTo(line[i - 1][0], line[i - 1][1]);
      g.lineTo(line[i][0], line[i][1]);
    }
    g.stroke();
  }
  g.restore();
  const leaves = [[890, 560, -0.7, 96], [790, 666, 0.8, 90], [720, 598, -1.0, 78], [610, 686, 0.9, 72], [944, 646, 0.35, 84], [520, 628, -1.2, 60]];
  leaves.forEach(([x, y, a, len], i) => {
    const shape = leaf(x, y, len, len * 0.3, a);
    pencil(g, R, 'leafp' + i, shape, true);
    wash(g, R, 'leaf' + i, shape, P.sap, { layers: 14, alpha: 0.06, spread: 0.08, rim: 0.12, second: i % 2 ? P.ochre : P.hooker, share: 0.5 });
    const half = shape.slice(0, 9);
    wash(g, R, 'leafd' + i, half, P.hooker, { layers: 8, alpha: 0.06, spread: 0.08, rim: 0.1 });
    lift(g, R, 'vein' + i, leaf(x, y, len * 0.8, 2.5, a), 0.55);
  });
  for (let i = 0; i < 5; i++) {
    const x = 660 + i * 56 + R('berry', 'x', i) * 20; const y = 668 + (i % 2) * 20;
    wash(g, R, 'berry' + i, blob(x, y, 9, 9, 10), P.rose, { layers: 10, alpha: 0.14, spread: 0.06, rim: 0.2, mottle: 0 });
    g.fillStyle = P.paper;
    g.fillRect(x - 4, y - 5, 2.5, 2.5);
  }

  // The subject, light to dark: pencil first, then glazes, and the paper
  // kept or lifted back for the lights.
  const b = bird(455, 455, 262, -0.06);
  pencil(g, R, 'bodyp', b.body, true);
  pencil(g, R, 'wingp', b.wing, true);
  pencil(g, R, 'tailp', b.tail, true);
  // The body is one wet shape: a pale wash first, then blue dropped in from
  // the top and a warm shadow from below, both spreading only as far as the
  // water, so the body keeps one edge.
  const body = wash(g, R, 'body', b.body, P.peach, { layers: 12, alpha: 0.025, spread: 0.1, rim: 0, second: P.ochre, share: 0.5 });
  const [, top] = b.at([[0, -0.72]])[0]; const [, low] = b.at([[0, 0.5]])[0];
  const [left] = b.at([[-0.7, 0]])[0]; const [right] = b.at([[0.8, 0]])[0];
  g.save();
  path(g, body);
  g.clip();
  wash(g, R, 'back', (u) => [[left - 40, top - 40], [right + 40, top - 40], [right + 40, top + 90 + 90 * u], [(left + right) / 2, top + 120 + 110 * u], [left - 40, top + 150 + 80 * u]],
    P.cerulean, { layers: 26, alpha: 0.04, spread: 0.14, rim: 0, second: P.ultramarine, share: 0.35 });
  wash(g, R, 'shade', (u) => [[left - 40, low + 40], [right + 40, low + 40], [right + 40, low - 20 - 50 * u], [(left + right) / 2, low - 50 - 70 * u], [left - 40, low - 30 - 60 * u]],
    P.sienna, { layers: 16, alpha: 0.03, spread: 0.14, rim: 0, second: P.rose, share: 0.45 });
  g.restore();
  wash(g, R, 'bodyrim', b.body, P.cerulean, { layers: 0, rim: 0.07 });
  lift(g, R, 'shine', b.at(chaikin([[0.3, -0.56], [0.46, -0.62], [0.5, -0.56], [0.36, -0.5]], 2, true)), 0.5);
  wash(g, R, 'tail', b.tail, P.ultramarine, { layers: 14, alpha: 0.045, spread: 0.08, rim: 0.1, second: P.payne, share: 0.2, mottle: 0.7 });
  wash(g, R, 'wing', b.wing, P.ultramarine, { layers: 14, alpha: 0.045, spread: 0.08, rim: 0.12, second: P.sienna, share: 0.3, mottle: 0.7 });
  granulate(g, R, 'wingg', b.wing, P.ultramarine, 900, 1.6);
  // Feather tips: three strokes of the brush's point.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.strokeStyle = P.ultramarine;
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    g.globalAlpha = 0.4;
    g.lineWidth = 3 - k * 0.6;
    path(g, wobble(b.at([[0.02 - k * 0.1, -0.08 + k * 0.05], [-0.5 + k * 0.06, -0.21 + k * 0.05]]), R, 'quill' + k, 1.4, 12), false);
    g.stroke();
  }
  g.restore();
  wash(g, R, 'cheek', blob(b.cheek[0], b.cheek[1], 22, 15, 12), P.rose, { layers: 12, alpha: 0.04, spread: 0.25, rim: 0 });
  wash(g, R, 'beak', b.beak, P.ochre, { layers: 12, alpha: 0.12, spread: 0.05, rim: 0.2, mottle: 0.3 });
  wash(g, R, 'beaks', [b.beak[0], b.beak[1], [b.beak[2][0], b.beak[2][1] - 6]], P.sienna, { layers: 8, alpha: 0.1, spread: 0.06, mottle: 0.3 });
  wash(g, R, 'eye', blob(b.eye[0], b.eye[1], 12, 12, 12), P.payne, { layers: 12, alpha: 0.2, spread: 0.05, rim: 0.3, mottle: 0 });
  g.fillStyle = P.paper;
  g.beginPath();
  g.arc(b.eye[0] + 4, b.eye[1] - 4, 3.4, 0, Math.PI * 2);
  g.fill();
  // Legs: two strokes of dark paint gripping the branch.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.strokeStyle = P.umber;
  g.lineCap = 'round';
  g.globalAlpha = 0.7;
  g.lineWidth = 3.6;
  for (const [i, leg] of b.legs.entries()) {
    path(g, wobble([leg[0], [leg[1][0] + 4, 652]], R, 'leg' + i, 1, 10), false);
    g.stroke();
  }
  g.restore();

  // Flicks of paint, and the paper's tooth over everything.
  splatter(g, R, 'spl1', 190, 520, 90, P.cerulean, 16);
  splatter(g, R, 'spl2', 860, 820, 80, P.sap, 14);
  splatter(g, R, 'spl3', 760, 250, 50, P.rose, 8);
  tooth(g, R);

  caption(g, 'WATERCOLOUR', font, 'rgba(80, 76, 72, 0.75)');
}

module.exports = { name: 'watercolour', size: { w: 1000, h: 1000 }, seed: 2026, draw };
