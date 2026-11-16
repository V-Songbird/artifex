// Star atlas: a printed celestial chart. A projected grid of right ascension
// and declination curves across a deep blue sky; stars are flat discs sized
// by magnitude, the Milky Way a band of fine dots, constellations thin lines
// between bright stars over a faint engraved figure, and deep-sky objects
// chart symbols. A graduated border and a legend when the piece is a chart.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { fbm } = require('../../../core/rand.js');
const font = require('../../../core/stroke-font.js');
const { path } = require('./kit.js');

const PALETTE = {
  sky: '#0d1b39',
  deep: '#081228',
  middle: '#13274c',
  grid: 'rgba(120, 146, 196, 0.42)',
  frame: '#c9d4ec',
  label: 'rgba(201, 212, 236, 0.85)',
  figure: 'rgba(176, 196, 236, 0.7)',
  line: '#e6d49a',
  ecliptic: '#d6b25a',
  star: ['#f8f5ea', '#dfe9ff', '#fff0cf', '#ffd9a8'],
  galaxy: '#e0907a',
  cluster: '#e8cf6a',
  nebula: '#7fc7a4',
};
const C = PALETTE;

// A chart label in the stroke font, centred on x with its top at y.
function label(g, text, x, y, size, colour = C.label) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = Math.max(1.1, size * 0.14);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  font.text(g, text, x - font.width(text, size) / 2, y, size);
  g.restore();
}

// A signed declination label such as +40 at (x, y): the number, and its sign
// drawn as strokes 13 left of x, since the stroke font has no plus sign.
function decLabel(g, deg, x, y, size = 10) {
  label(g, String(Math.abs(deg)), x + 2, y - 5, size);
  g.save();
  g.strokeStyle = C.label;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(x - 17, y); g.lineTo(x - 9, y);
  if (deg >= 0) { g.moveTo(x - 13, y - 4); g.lineTo(x - 13, y + 4); }
  g.stroke();
  g.restore();
}

// A star's radius for its magnitude: 5.4 units at magnitude 0, never under 0.55.
function radius(mag) {
  return Math.max(0.55, 5.4 - mag * 0.82);
}

// A star by magnitude: a flat disc, a gap of sky 2.2 wider round any star
// over radius 1.6 so lines stop short of it, and a halo to 4.5 times its
// radius under magnitude 2.4. `gap` is the sky colour under it.
function star(g, x, y, mag, tint = C.star[0], gap = C.sky) {
  const r = radius(mag);
  if (mag < 2.4) {
    const halo = g.createRadialGradient(x, y, r, x, y, r * 4.5);
    halo.addColorStop(0, 'rgba(220, 230, 255, 0.28)');
    halo.addColorStop(1, 'rgba(220, 230, 255, 0)');
    g.fillStyle = halo;
    g.fillRect(x - r * 4.5, y - r * 4.5, r * 9, r * 9);
  }
  if (r > 1.6) {
    g.fillStyle = gap;
    g.beginPath();
    g.arc(x, y, r + 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = tint;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// A magnitude for a uniform u in [0, 1): from `brightest` down, each
// magnitude holding about three times the stars of the one brighter.
function magnitude(u, brightest = 1.5) {
  return brightest + Math.log(1 + u * 242) / Math.log(3);
}

// n field stars scattered over [x0, y0, x1, y1] as [x, y, mag, tint], by
// address `name`; draw each with `star`.
function starField(R, name, [x0, y0, x1, y1], n) {
  const field = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + R(name, 'x', i) * (x1 - x0);
    const y = y0 + R(name, 'y', i) * (y1 - y0);
    field.push([x, y, magnitude(R(name, 'm', i)), C.star[Math.floor(R(name, 't', i) * 4)]]);
  }
  return field;
}

// The sky: a radial gradient from the lighter middle at circle (inner, r0)
// to the sky at circle (outer, r1), filling [x, y, w, h].
function sky(g, inner, outer, r0, r1, [x, y, w, h]) {
  const glow = g.createRadialGradient(inner[0], inner[1], r0, outer[0], outer[1], r1);
  glow.addColorStop(0, C.middle);
  glow.addColorStop(1, C.sky);
  g.fillStyle = glow;
  g.fillRect(x, y, w, h);
}

// The Milky Way over [x, y, w, h]: seven soft glows of radius 230 from
// `from` to `to`, then n candidate dots kept where a Gaussian band (points p
// with p . normal - offset near 0, `width` wide, bent `bend` by fbm) times a
// clumping fbm beats a random number. Dots 0.5 to 1.3 at alpha 0.25 to 0.7.
// `fields` names the two fbm fields, so a second band can differ.
function milkyWay(g, R, name, { from, to, normal, offset, width = 150, bend = 90, n = 42000, area, fields = ['bend', 'clump'] }) {
  const band = (x, y) => {
    const d = x * normal[0] + y * normal[1] - offset + bend * (fbm(R, x / 300, y / 300, 2, fields[0]) - 0.5);
    return Math.exp(-((d / width) ** 2));
  };
  for (let i = 0; i < 7; i++) {
    const t = i / 6; const x = from[0] + t * (to[0] - from[0]); const y = from[1] + t * (to[1] - from[1]);
    const soft = g.createRadialGradient(x, y, 10, x, y, 230);
    soft.addColorStop(0, 'rgba(150, 170, 220, 0.09)');
    soft.addColorStop(1, 'rgba(150, 170, 220, 0)');
    g.fillStyle = soft;
    g.fillRect(x - 230, y - 230, 460, 460);
  }
  const [ax, ay, aw, ah] = area;
  for (let i = 0; i < n; i++) {
    const x = ax + R(name, 'x', i) * aw; const y = ay + R(name, 'y', i) * ah;
    const k = band(x, y) * (fbm(R, x / 70, y / 70, 3, fields[1]) - 0.25) * 1.6;
    if (R(name, 'keep', i) > k) continue;
    g.fillStyle = 'rgba(205, 215, 245, ' + (0.25 + 0.45 * R(name, 'a', i)).toFixed(2) + ')';
    const r = 0.5 + 0.8 * R(name, 'r', i);
    g.fillRect(x - r / 2, y - r / 2, r, r);
  }
}

// A projected graticule round a `pole` (usually off the sheet): declination
// arcs of each radius in `radii`, `span` radians either side of `facing`, and
// hour rays at each angle in `angles` from radius `from` to `to`.
function graticule(g, pole, radii, angles, { facing = Math.PI / 2, span = 0.5, from = 1600, to = 3200, width = 1.2 } = {}) {
  g.strokeStyle = C.grid;
  g.lineWidth = width;
  for (const r of radii) {
    g.beginPath();
    g.arc(pole[0], pole[1], r, facing - span, facing + span);
    g.stroke();
  }
  for (const a of angles) {
    g.beginPath();
    g.moveTo(pole[0] + Math.cos(a) * from, pole[1] + Math.sin(a) * from);
    g.lineTo(pole[0] + Math.cos(a) * to, pole[1] + Math.sin(a) * to);
    g.stroke();
  }
}

// Where the hour ray at angle a from `pole` crosses the horizontal line y: its x.
function rayX(pole, a, y) {
  const t = (y - pole[1]) / Math.sin(a);
  return pole[0] + Math.cos(a) * t;
}

// Where the declination arc of radius r round `pole` crosses the vertical line x: its y below the pole.
function arcY(pole, r, x) {
  return pole[1] + Math.sqrt(Math.max(0, r * r - (x - pole[0]) ** 2));
}

// The ecliptic: a dashed [10, 7] line through pts, 1.6 wide, gold at 0.75.
function ecliptic(g, pts) {
  g.save();
  g.strokeStyle = C.ecliptic;
  g.globalAlpha = 0.75;
  g.lineWidth = 1.6;
  g.setLineDash([10, 7]);
  g.beginPath();
  pts.forEach(([x, y], i) => { if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  g.stroke();
  g.restore();
}

// An engraved figure under a constellation: each closed outline in
// `outlines` stroked faint, 1.3 wide; then `engrave()` runs with the pen at
// 0.9 wide for interior detail such as hatching and feature lines.
function figure(g, outlines, engrave) {
  g.save();
  g.strokeStyle = C.figure;
  g.lineWidth = 1.3;
  g.lineJoin = 'round';
  for (const part of outlines) {
    path(g, part);
    g.stroke();
  }
  g.lineWidth = 0.9;
  if (engrave) engrave();
  g.restore();
}

// Engraver's hatching: a short stroke from each point in `pts` along the
// offset [dx, dy], in the current pen; run inside `figure`'s engrave.
function hatchAlong(g, pts, [dx, dy]) {
  for (const [x, y] of pts) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + dx, y + dy);
    g.stroke();
  }
}

// Constellation lines: each [p, q] in `links` a thin straight line, 1.8 wide,
// pale gold at 0.85. Draw before the stars, so each star's gap cuts them.
function constellation(g, links) {
  g.save();
  g.strokeStyle = C.line;
  g.globalAlpha = 0.85;
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  for (const [p, q] of links) {
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(q[0], q[1]);
    g.stroke();
  }
  g.restore();
}

// A constellation boundary stepped along the grid: dotted [3, 5], each step
// [radius, a0, a1] an arc round `pole`, joined by a run along the hour ray.
function boundary(g, pole, steps) {
  g.save();
  g.strokeStyle = 'rgba(214, 178, 90, 0.55)';
  g.lineWidth = 1.2;
  g.setLineDash([3, 5]);
  g.beginPath();
  steps.forEach(([r, a0, a1], i) => {
    if (i > 0) g.lineTo(pole[0] + Math.cos(a0) * r, pole[1] + Math.sin(a0) * r);
    if (a1 < a0) g.arc(pole[0], pole[1], r, a0, a1, true); else g.arc(pole[0], pole[1], r, a0, a1);
  });
  g.closePath();
  g.stroke();
  g.restore();
}

// A galaxy's chart symbol: an ellipse rx by ry at angle a.
function galaxy(g, x, y, rx, ry, a) {
  g.save();
  g.strokeStyle = C.galaxy;
  g.lineWidth = 1.4;
  g.beginPath();
  g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// An open cluster's chart symbol: a dotted circle of radius r.
function cluster(g, x, y, r) {
  g.save();
  g.strokeStyle = C.cluster;
  g.lineWidth = 1.4;
  g.setLineDash([2, 3]);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// A nebula's chart symbol: a square of half side r.
function nebula(g, x, y, r) {
  g.save();
  g.strokeStyle = C.nebula;
  g.lineWidth = 1.4;
  g.strokeRect(x - r, y - r, 2 * r, 2 * r);
  g.restore();
}

// A legend box [x, y, w, h] (250 by 128 fits): magnitudes 0 to 5 as stars
// with their numbers, and the galaxy, cluster and nebula symbols named.
function legend(g, x, y, w, h) {
  g.fillStyle = C.deep;
  g.fillRect(x, y, w, h);
  g.strokeStyle = C.frame;
  g.lineWidth = 1.2;
  g.strokeRect(x, y, w, h);
  label(g, 'MAGNITUDES', x + w / 2, y + 12, 9);
  for (let m = 0; m <= 5; m++) {
    const sx = x + 30 + m * 38; const sy = y + 46;
    star(g, sx, sy, m + 0.2);
    label(g, String(m), sx, sy + 14, 8);
  }
  [[galaxy, 'GALAXY'], [cluster, 'CLUSTER'], [nebula, 'NEBULA']].forEach(([mark, name], k) => {
    const sx = x + 22 + k * 80; const sy = y + 100;
    if (mark === galaxy) mark(g, sx, sy, 10, 5, -0.3); else mark(g, sx, sy, mark === nebula ? 5 : 7);
    label(g, name, sx + 14 + font.width(name, 7) / 2, sy - 4, 7);
  });
}

// A graduated border round [x0, y0, x1, y1]: a rule 1.6 wide on the edge,
// rules at `band` and `outer` outside it, and between the first two
// segments `seg` long, alternately filled.
function border(g, [x0, y0, x1, y1], { band = 7, outer = 16, seg = 23 } = {}) {
  g.strokeStyle = C.frame;
  g.lineWidth = 1.6;
  g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  g.lineWidth = 1;
  g.strokeRect(x0 - band, y0 - band, x1 - x0 + 2 * band, y1 - y0 + 2 * band);
  g.strokeRect(x0 - outer, y0 - outer, x1 - x0 + 2 * outer, y1 - y0 + 2 * outer);
  g.fillStyle = C.frame;
  for (let k = 0; k * seg < Math.max(x1 - x0, y1 - y0); k += 2) {
    const a = x0 + k * seg; const b = y0 + k * seg;
    if (a < x1) {
      const len = Math.min(seg, x1 - a);
      g.fillRect(a, y0 - band, len, band);
      g.fillRect(a, y1, len, band);
    }
    if (b < y1) {
      const len = Math.min(seg, y1 - b);
      g.fillRect(x0 - band, b, band, len);
      g.fillRect(x1, b, band, len);
    }
  }
}

module.exports = {
  PALETTE, label, decLabel, radius, star, magnitude, starField, sky, milkyWay, graticule, rayX, arcY, ecliptic,
  figure, hatchAlong, constellation, boundary, galaxy, cluster, nebula, legend, border,
};
