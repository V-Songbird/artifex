// Doodle: ballpoint sketches in a school notebook. Ruled paper, a red margin
// and punched holes; one pen drawn with sketchy double strokes, shaded by
// hatching, never by fills; bubble letters over a highlighter swipe, and
// words in the same pen.
//
// A parts bin: functions that draw the style's marks on any path,
// outline or area you give them. Nothing here picks a subject, a scene or a
// layout.

'use strict';

const font = require('../../../core/stroke-font.js');
const { path, wobble, grain, shadow } = require('./kit.js');

// The page, the pens (blue ballpoint twice as likely as black or violet),
// the red accent pen and the highlighters.
const PAPER = '#fbfaf4';
const BLUE = 'rgba(31, 58, 147, 0.88)';
const INKS = [BLUE, BLUE, 'rgba(30, 30, 38, 0.88)', 'rgba(88, 44, 150, 0.88)'];
const RED = 'rgba(200, 45, 60, 0.85)';
const MARKERS = ['rgba(255, 232, 60, 0.55)', 'rgba(255, 120, 185, 0.42)', 'rgba(110, 235, 130, 0.48)'];

// A notebook page, `w` by `h`: paper, blue rules every `rule` from `top`
// (null for none), a red margin line at x `margin` (null for none), punched
// holes at x `holeX` and each y in `holes`, and light grain.
function page(g, R, w, h, opts = {}) {
  const { paper = PAPER, top = 118, rule = 34, margin = 112, holeX = 52, holes = [], specks = Math.round((2500 * w * h) / 1e6) } = opts;
  g.fillStyle = paper;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120, 165, 220, 0.55)';
  g.lineWidth = 1.6;
  if (rule) for (let y = top; y < h; y += rule) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  if (margin !== null) {
    g.strokeStyle = 'rgba(225, 120, 130, 0.8)';
    g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(margin, 0); g.lineTo(margin, h); g.stroke();
  }
  for (const y of holes) {
    g.save();
    shadow(g, 'rgba(0, 0, 0, 0.18)', 4, 1, 2);
    g.fillStyle = '#dcd8cc';
    g.beginPath(); g.arc(holeX, y, 17, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  grain(g, R, 'grain', w, h, specks, 'rgba(255,255,255,0.5)', 'rgba(90,80,60,0.05)');
}

// A pen line along `pts`: drawn `passes` times (2) with independent wobble,
// like a hand going over it, the second pass 0.7 as wide and looser.
function pen(g, R, name, pts, opts = {}) {
  const { close = false, ink = BLUE, width = 2.6, passes = 2 } = opts;
  g.save();
  g.strokeStyle = ink;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let k = 0; k < passes; k++) {
    g.lineWidth = width * (k ? 0.7 : 1);
    path(g, wobble(pts, R, name + k, k ? 2.2 : 1.3, 7, close), close);
    g.stroke();
  }
  g.restore();
}

// Hatching: parallel wobbly pen lines at `angle`, `spacing` apart, clipped to
// `region`. Two calls at crossing angles make a darker shade.
function hatch(g, R, name, region, opts = {}) {
  const { angle = 0.8, spacing = 8, ink = BLUE, width = 1.6 } = opts;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of region) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const r = Math.hypot(x1 - x0, y1 - y0) / 2;
  const ux = Math.cos(angle); const uy = Math.sin(angle);
  g.save();
  path(g, region);
  g.clip();
  g.strokeStyle = ink;
  g.lineWidth = width;
  g.lineCap = 'round';
  let i = 0;
  for (let k = -r; k <= r; k += spacing, i++) {
    const a = [cx - ux * r - uy * k, cy - uy * r + ux * k]; const b = [cx + ux * r - uy * k, cy + uy * r + ux * k];
    path(g, wobble([a, b], R, name + i, 1.2, 14), false);
    g.stroke();
  }
  g.restore();
}

// A highlighter swipe along `pts`: one round translucent stroke `width` wide,
// wobbled a little. Lay it before the pen work it sits under.
function highlight(g, R, name, pts, colour = MARKERS[0], width = 64) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = 'round';
  path(g, wobble(pts, R, name, 3, 30), false);
  g.stroke();
  g.restore();
}

// Bubble letters from (x, y), `size` tall: the stroke-font text stroked
// `weight` wide in ink, offset by `depth` for a drop, again in place, then
// hollowed with an `inner` stroke in the paper colour.
function bubble(g, text, x, y, size, opts = {}) {
  const { ink = BLUE, paper = PAPER, weight = size * 0.4, inner = weight * 0.8, depth = size / 15 } = opts;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = ink;
  g.lineWidth = weight;
  font.text(g, text, x + depth, y + depth, size);
  g.strokeStyle = ink;
  g.lineWidth = weight;
  font.text(g, text, x, y, size);
  g.strokeStyle = paper;
  g.lineWidth = inner;
  font.text(g, text, x, y, size);
  g.restore();
}

// Words in the pen from (x, y), `size` tall, turned by `rot`. Set `mirror`
// when drawing inside a horizontally mirrored transform: the words then
// still read left to right, ending where they would have started.
function write(g, text, x, y, size, opts = {}) {
  const { ink = BLUE, rot = 0, mirror = false, width = size < 24 ? 2.2 : 2.4 } = opts;
  g.save();
  g.strokeStyle = ink;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(x, y);
  if (mirror) g.scale(-1, 1);
  g.rotate(rot);
  font.text(g, text, mirror ? -font.width(text, size) : 0, 0, size);
  g.restore();
}

module.exports = { PAPER, BLUE, INKS, RED, MARKERS, page, pen, hatch, highlight, bubble, write };
