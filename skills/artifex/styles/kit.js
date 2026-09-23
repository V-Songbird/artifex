// Drawing helpers the style references share. Subject-neutral: outlines in,
// marks out. Coordinates are design units; nothing here assumes a subject.

'use strict';

const { resample } = require('../../../core/geom.js');
const { noise2 } = require('../../../core/rand.js');

// Place unit points at (x, y) with scale s, optional mirror and rotation.
function place(pts, x, y, s, rot = 0, flip = false) {
  const c = Math.cos(rot); const k = Math.sin(rot); const f = flip ? -1 : 1;
  return pts.map(([u, v]) => [x + (u * f * c - v * k) * s, y + (u * f * k + v * c) * s]);
}

function path(g, pts, close = true) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
}

// Add a closed polygon to the current path without starting a new one, for
// unions and even-odd clips. `path` would discard what came before.
function sub(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

// A hand's wobble: resample, then push each point by two independent noises.
function wobble(pts, R, name, amp, step, close = false) {
  const even = resample(pts, step, close);
  return even.map(([x, y], i) => [
    x + (noise2(R, i * 0.23, 1.7, name + 'x') - 0.5) * 2 * amp,
    y + (noise2(R, i * 0.23, 5.3, name + 'y') - 0.5) * 2 * amp,
  ]);
}

function ellipse(cx, cy, rx, ry, n = 48, rot = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = Math.cos(a) * rx; const v = Math.sin(a) * ry;
    out.push([cx + u * Math.cos(rot) - v * Math.sin(rot), cy + u * Math.sin(rot) + v * Math.cos(rot)]);
  }
  return out;
}

function star(cx, cy, r, points = 5, inner = 0.45, rot = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const k = i % 2 ? r * inner : r;
    out.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]);
  }
  return out;
}

// Printed-paper grain: light and dark specks, addressed so every frame agrees.
function grain(g, R, name, w, h, n, light, dark) {
  for (let i = 0; i < n; i++) {
    const x = R(name, 'x', i) * w; const y = R(name, 'y', i) * h;
    const k = 0.8 + R(name, 'k', i) * 1.6;
    g.fillStyle = R(name, 'tone', i) < 0.5 ? light : dark;
    g.fillRect(x, y, k, k);
  }
}

// Canvas shadows ignore the transform, so they are scaled by it:
// a shadow keeps its size relative to the drawing at every output size.
function scaleOf(g) {
  const m = g.getTransform();
  return Math.hypot(m.a, m.b);
}

function shadow(g, colour, blur, dx = 0, dy = 0) {
  const k = scaleOf(g);
  g.shadowColor = colour;
  g.shadowBlur = blur * k;
  g.shadowOffsetX = dx * k;
  g.shadowOffsetY = dy * k;
}

function caption(g, text, font, colour, x = 40, y = 950, size = 14) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  font.text(g, text, x, y, size);
  g.restore();
}

module.exports = { place, path, sub, wobble, ellipse, star, grain, shadow, caption };
