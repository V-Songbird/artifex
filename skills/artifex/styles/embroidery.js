// Embroidery: bright thread on a dark cloth. Every line wobbles like a hand's,
// fills are stitched back and forth, and each strand carries a dark edge and
// a streaky sheen, the way satin stitches catch light.
//
// A parts bin: functions that draw the style's marks on any path,
// outline or area you give them. Nothing here picks a subject, a scene or a
// layout.

'use strict';

const { path, wobble, shadow } = require('./kit.js');

// Thread colours as triples: [body, dark under-edge, light sheen].
const THREADS = {
  purple: ['#8a4fd8', '#4b2a86', '#c6a3f7'],
  red: ['#ef4a3c', '#9e2a22', '#ff9a86'],
  yellow: ['#f7c52b', '#a47a0c', '#fff0a8'],
  green: ['#3dbb58', '#1f7a35', '#9be8aa'],
  blue: ['#2e8ee6', '#1a5494', '#9fd0fa'],
  orange: ['#f6892a', '#a4520f', '#ffd0a0'],
  brown: ['#8a5a3c', '#4f3122', '#c69a78'],
  white: ['#f4f2ff', '#8a86b8', '#ffffff'],
  black: ['#1c1640', '#0a0820', '#6a62a8'],
};

// The cloth, `w` by `h`: a dark ground and a faint diagonal weave of short
// dashes at `angle`. `dashes` defaults to 340 per million square units.
// Leaves the line cap round.
function cloth(g, R, w, h, opts = {}) {
  const { colour = '#10153a', weave = 'rgba(170, 180, 255, 0.07)', angle = -1.15, dashes = Math.round((340 * w * h) / 1e6) } = opts;
  g.fillStyle = colour;
  g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  g.strokeStyle = weave;
  g.lineWidth = 2.2;
  for (let i = 0; i < dashes; i++) {
    const x = R('dash', 'x', i) * w; const y = R('dash', 'y', i) * h;
    const a = angle + (R('dash', 'a', i) - 0.5) * 0.25; const l = 8 + R('dash', 'l', i) * 8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
}

// One strand of thread along `pts` (wobble it first with kit's `wobble`):
// the dark tone `width` wide offset down-right as its under-edge, the body at
// 0.78 of it, and a dashed light sheen offset toward the upper left.
function strand(g, pts, thread, width, close = false) {
  const [body, dark, light] = thread;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(2, 2.5);
  g.strokeStyle = dark;
  g.lineWidth = width;
  path(g, pts, close);
  g.stroke();
  g.restore();
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = body;
  g.lineWidth = width * 0.78;
  path(g, pts, close);
  g.stroke();
  g.globalAlpha = 0.7;
  g.strokeStyle = light;
  g.lineWidth = Math.max(1.5, width * 0.13);
  g.setLineDash([width * 2.4, width * 0.8]);
  g.translate(-width * 0.15, -width * 0.15);
  path(g, pts, close);
  g.stroke();
  g.restore();
}

// The path of a satin stitch: back and forth across the polygon's bounding
// circle at `angle`, `spacing` apart, as one boustrophedon polyline.
function zigzag(poly, angle, spacing) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const r = Math.hypot(x1 - x0, y1 - y0) / 2 + 8;
  const ux = Math.cos(angle); const uy = Math.sin(angle);
  const out = [];
  let flip = false;
  for (let k = -r; k <= r; k += spacing) {
    const a = [cx - ux * r - uy * k, cy - uy * r + ux * k];
    const b = [cx + ux * r - uy * k, cy + uy * r + ux * k];
    out.push(...(flip ? [b, a] : [a, b]));
    flip = !flip;
  }
  return out;
}

// A satin-stitch fill of `poly`: a 45% underfill of the dark tone, a wobbled
// zigzag `width` wide at `angle` and `spacing` in the body colour, then a
// sparser crossing pass of the light tone, all clipped to the shape.
function satin(g, R, name, poly, thread, spacing, width, angle) {
  const [body, dark, light] = thread;
  g.save();
  path(g, poly);
  g.clip();
  g.globalAlpha = 0.45;
  g.fillStyle = dark;
  path(g, poly);
  g.fill();
  g.globalAlpha = 1;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = body;
  g.lineWidth = width;
  path(g, wobble(zigzag(poly, angle, spacing), R, name, 2.4, 12), false);
  g.stroke();
  g.globalAlpha = 0.35;
  g.strokeStyle = light;
  g.lineWidth = width * 0.35;
  path(g, wobble(zigzag(poly, angle + 0.55, spacing * 1.7), R, name + 'x', 2.4, 12), false);
  g.stroke();
  g.restore();
}

// A French knot or a bead: a solid dot of radius `r` in the thread's body colour.
function knot(g, x, y, r, thread) {
  g.fillStyle = thread[0];
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// A glint of metallic thread or a sequin: a white four-pointed star of
// radius `r` with a soft glow.
function sparkle(g, x, y, r) {
  const k = r * 0.2;
  g.save();
  shadow(g, 'rgba(255, 255, 255, 0.85)', 12);
  g.fillStyle = '#ffffff';
  path(g, [[x - r, y], [x - k, y - k], [x, y - r], [x + k, y - k], [x + r, y], [x + k, y + k], [x, y + r], [x - k, y + k]]);
  g.fill();
  g.restore();
}

module.exports = { THREADS, cloth, strand, zigzag, satin, knot, sparkle };
