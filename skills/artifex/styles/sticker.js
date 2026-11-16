// Sticker: die-cut vinyl. Each sticker's white border follows its art's
// outline and casts one soft shadow; the art inside is bold outlines, flat
// fills, a cel shade and a white gloss; a sticker can peel, its corner folded
// back to show the backing.
//
// A parts bin: functions that draw the style's marks on any path,
// outline or area you give them. Nothing here picks a subject, a scene or a
// layout.

'use strict';

const font = require('../../../core/stroke-font.js');
const { path, sub, ellipse, grain, shadow } = require('./kit.js');

// The dark violet line every outline and eye is drawn in.
const LINE = '#2b2340';

// All parts as one path, so a stroke of it is one stroke of their union.
function union(g, parts) {
  g.beginPath();
  for (const p of parts) sub(g, p);
}

// A cutting mat, `w` by `h`: a pale ground, a grid every `cell` with a
// heavier line every `major`, ruler ticks every `tick` along the top, and
// light grain. A surface to lay stickers on.
function mat(g, R, w, h, opts = {}) {
  const { colour = '#e8e3f4', cell = 50, major = 250, tick = 10 } = opts;
  const n = Math.max(w, h);
  g.fillStyle = colour;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(95, 80, 150, 0.14)';
  g.lineWidth = 1.2;
  for (let k = cell; k < n; k += cell) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.moveTo(0, k); g.lineTo(w, k); g.stroke();
  }
  g.strokeStyle = 'rgba(95, 80, 150, 0.26)';
  g.lineWidth = 2;
  for (let k = major; k < n; k += major) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.moveTo(0, k); g.lineTo(w, k); g.stroke();
  }
  for (let k = tick; k < w; k += tick) {
    const long = k % cell === 0;
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, long ? 16 : 8); g.stroke();
  }
  grain(g, R, 'grain', w, h, Math.round((2500 * w * h) / 1e6), 'rgba(255,255,255,0.10)', 'rgba(60,40,110,0.05)');
}

// The white vinyl under a sticker's art: one stroke of the union of `parts`,
// `border` wide on each side, casts the one soft shadow (`cast`, `blur`,
// `dx`, `dy`); then a faint `rim` at its edge, the border again, and every
// part filled white so no surface shows through.
function dieCut(g, parts, border, opts = {}) {
  const { cast = 'rgba(52, 36, 92, 0.30)', blur = 22, dx = 5, dy = 12, rim = 'rgba(60, 40, 110, 0.13)', vinyl = '#ffffff' } = opts;
  g.save();
  g.lineJoin = 'round';
  shadow(g, cast, blur, dx, dy);
  g.strokeStyle = vinyl;
  g.lineWidth = border * 2;
  union(g, parts);
  g.stroke();
  g.restore();
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = rim;
  g.lineWidth = border * 2 + 3;
  union(g, parts);
  g.stroke();
  g.strokeStyle = vinyl;
  g.lineWidth = border * 2;
  union(g, parts);
  g.stroke();
  g.fillStyle = vinyl;
  for (const p of parts) { path(g, p); g.fill(); }
  g.restore();
}

// Flat art with a bold outline: every part stroked `width` x 2 in `line`,
// then every part filled, so only the group's outer edge keeps its line.
function inked(g, parts, fill, width = 6, line = LINE) {
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = line;
  g.lineWidth = width * 2;
  for (const p of parts) { path(g, p); g.stroke(); }
  g.fillStyle = fill;
  for (const p of parts) { path(g, p); g.fill(); }
  g.restore();
}

// A gloss streak: one curved white stroke from `a` through control `c` to
// `b`, `width` wide. Draw it inside the part's clip, before its outline.
function gloss(g, a, c, b, width = 10, colour = 'rgba(255, 255, 255, 0.85)') {
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.quadraticCurveTo(c[0], c[1], b[0], b[1]);
  g.stroke();
}

// A sticker eye at (x, y) for a character of size `s`: a dark upright oval,
// 0.068 s by 0.085 s, with a large and a small white highlight.
function eye(g, x, y, s, line = LINE) {
  g.fillStyle = line;
  path(g, ellipse(x, y, 0.068 * s, 0.085 * s));
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x + 0.022 * s, y - 0.03 * s, 0.028 * s, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(x - 0.02 * s, y + 0.035 * s, 0.013 * s, 0, Math.PI * 2);
  g.fill();
}

// Bold stroke-font lettering centred on (cx, cy): `size` tall, `width` thick
// (7 to 8 at size 40, so it holds against the vinyl).
function lettering(g, text, cx, cy, size, width, colour) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  font.text(g, text, cx - font.width(text, size) / 2, cy - size / 2, size);
  g.restore();
}

// A rectangle `w` by `h` from (x, y) with corners of radius `r`, as points:
// the shape of a label or a bubble.
function roundRect(x, y, w, h, r) {
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

// The part of a polygon on one side (`sign` +1 or -1) of the line a-b.
function cutBy(poly, a, b, sign) {
  const side = (p) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]; const q = poly[(i + 1) % poly.length];
    const sp = side(p); const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

// A point mirrored across the line a-b.
function mirror(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  return [2 * (a[0] + dx * t) - p[0], 2 * (a[1] + dy * t) - p[1]];
}

// A sticker peeling back along the fold a-b. `art()` draws the whole sticker
// (die-cut and art); only the side of the fold holding `keep` stays, clipped
// within the `w` by `h` canvas. Then the flap: the sticker's `outer` border
// beyond the fold, mirrored over it, shaded as pale backing under a small
// shadow.
function peel(g, { outer, a, b, keep, w, h }, art) {
  const sign = Math.sign((b[0] - a[0]) * (keep[1] - a[1]) - (b[1] - a[1]) * (keep[0] - a[0]));
  g.save();
  path(g, cutBy([[-50, -50], [w + 50, -50], [w + 50, h + 50], [-50, h + 50]], a, b, sign));
  g.clip();
  art();
  g.restore();
  const flap = cutBy(outer, a, b, -sign).map((p) => mirror(p, a, b));
  g.save();
  shadow(g, 'rgba(40, 30, 70, 0.35)', 12, -4, 6);
  const backing = g.createLinearGradient(a[0], a[1], flap[0][0], flap[0][1] + 40);
  backing.addColorStop(0, '#f6f3fb');
  backing.addColorStop(1, '#cfc7e2');
  g.fillStyle = backing;
  path(g, flap);
  g.fill();
  g.restore();
}

module.exports = { LINE, mat, dieCut, inked, gloss, eye, lettering, roundRect, cutBy, mirror, peel };
