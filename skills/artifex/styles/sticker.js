// Sticker: die-cut vinyl on a cutting mat. Each sticker's white border
// follows its art's outline and casts one soft shadow; one label is peeling,
// its corner folded back to show the backing.

'use strict';

const { rng } = require('../../../core/rand.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, sub, ellipse, star, grain, shadow, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const LINE = '#2b2340';

function outline(g, parts) {
  g.beginPath();
  for (const p of parts) sub(g, p);
}

// Shadow from one stroke of the union, a faint rim, then white vinyl.
function dieCut(g, parts, border) {
  g.save();
  g.lineJoin = 'round';
  shadow(g, 'rgba(52, 36, 92, 0.30)', 22, 5, 12);
  g.strokeStyle = '#ffffff';
  g.lineWidth = border * 2;
  outline(g, parts);
  g.stroke();
  g.restore();
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(60, 40, 110, 0.13)';
  g.lineWidth = border * 2 + 3;
  outline(g, parts);
  g.stroke();
  g.strokeStyle = '#ffffff';
  g.lineWidth = border * 2;
  outline(g, parts);
  g.stroke();
  g.fillStyle = '#ffffff';
  for (const p of parts) { path(g, p); g.fill(); }
  g.restore();
}

// Outline by stroking every part twice as wide, then filling over it, so
// only the outer edge of the group keeps its line.
function inked(g, parts, fill, width = 6) {
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = LINE;
  g.lineWidth = width * 2;
  for (const p of parts) { path(g, p); g.stroke(); }
  g.fillStyle = fill;
  for (const p of parts) { path(g, p); g.fill(); }
  g.restore();
}

function turn(pts, cx, cy, a) {
  const c = Math.cos(a); const s = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

function roundRect(x, y, w, h, r) {
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

// Keep the part of a polygon on one side of the line a-b.
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

function mirror(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  return [2 * (a[0] + dx * t) - p[0], 2 * (a[1] + dy * t) - p[1]];
}

function centred(g, text, cx, cy, size, width, colour) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  font.text(g, text, cx - font.width(text, size) / 2, cy - size / 2, size);
  g.restore();
}

function draw(g, s) {
  const R = rng(s.seed);

  g.fillStyle = '#e8e3f4';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(95, 80, 150, 0.14)';
  g.lineWidth = 1.2;
  for (let k = 50; k < W; k += 50) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, H); g.moveTo(0, k); g.lineTo(W, k); g.stroke();
  }
  g.strokeStyle = 'rgba(95, 80, 150, 0.26)';
  g.lineWidth = 2;
  for (let k = 250; k < W; k += 250) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, H); g.moveTo(0, k); g.lineTo(W, k); g.stroke();
  }
  for (let k = 10; k < W; k += 10) {
    const long = k % 50 === 0;
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, long ? 16 : 8); g.stroke();
  }
  grain(g, R, 'grain', W, H, 2500, 'rgba(255,255,255,0.10)', 'rgba(60,40,110,0.05)');

  // Star with a face.
  const st = star(190, 230, 88, 5, 0.52, -Math.PI / 2 - 0.2);
  dieCut(g, [st], 16);
  inked(g, [st], '#ffd23f');
  g.fillStyle = LINE;
  for (const dx of [-18, 18]) { path(g, ellipse(190 + dx, 222, 6, 8)); g.fill(); }
  g.strokeStyle = LINE;
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(190, 238, 14, 0.25, Math.PI - 0.25);
  g.stroke();

  // Eighth note.
  const note = [
    ellipse(820, 272, 46, 33, 32, -0.4),
    [[846, 266], [864, 262], [864, 110], [846, 110]],
    [[858, 110], [900, 128], [936, 170], [926, 222], [908, 186], [880, 162], [858, 158]],
  ].map((p) => turn(p, 850, 200, 0.18));
  dieCut(g, note, 16);
  inked(g, note, '#2ec4b6');
  g.fillStyle = 'rgba(255,255,255,0.75)';
  path(g, turn(ellipse(806, 260, 14, 7, 20, -0.4), 850, 200, 0.18));
  g.fill();

  // The bird.
  const b = bird(500, 530, 230, -0.08);
  dieCut(g, [b.tail, b.body, b.wing, b.beak], 26);
  inked(g, [b.tail], '#ff7a59', 3.5);
  g.fillStyle = '#ffcf5c';
  path(g, b.body);
  g.fill();
  g.save();
  path(g, b.body);
  g.clip();
  g.fillStyle = '#fff0bf';
  path(g, b.at(ellipse(0.22, 0.22, 0.42, 0.26)));
  g.fill();
  g.fillStyle = 'rgba(232, 140, 40, 0.35)';
  path(g, b.at(ellipse(-0.44, 0.3, 0.5, 0.34)));
  g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.13)';
  path(g, b.at([[-0.5, -0.9], [-0.38, -0.9], [0.42, 0.9], [0.3, 0.9]]));
  g.fill();
  g.restore();
  g.strokeStyle = LINE;
  g.lineWidth = 7;
  g.lineJoin = 'round';
  path(g, b.body);
  g.stroke();
  g.save();
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  g.lineWidth = 10;
  g.lineCap = 'round';
  const hl = b.at([[-0.22, -0.24], [-0.04, -0.44], [0.2, -0.56]]);
  g.beginPath();
  g.moveTo(hl[0][0], hl[0][1]);
  g.quadraticCurveTo(hl[1][0], hl[1][1], hl[2][0], hl[2][1]);
  g.stroke();
  g.restore();
  g.fillStyle = '#ff7a59';
  path(g, b.wing);
  g.fill();
  g.save();
  path(g, b.wing);
  g.clip();
  g.fillStyle = 'rgba(200, 70, 40, 0.35)';
  path(g, b.at(ellipse(-0.2, 0.08, 0.6, 0.14)));
  g.fill();
  g.restore();
  path(g, b.wing);
  g.stroke();
  g.fillStyle = '#ff9f1c';
  path(g, b.beak);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255, 143, 163, 0.9)';
  path(g, ellipse(b.cheek[0] + 4, b.cheek[1] + 4, 0.085 * b.s, 0.055 * b.s));
  g.fill();
  g.fillStyle = LINE;
  path(g, ellipse(b.eye[0], b.eye[1], 0.068 * b.s, 0.085 * b.s));
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(b.eye[0] + 0.022 * b.s, b.eye[1] - 0.03 * b.s, 0.028 * b.s, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(b.eye[0] - 0.02 * b.s, b.eye[1] + 0.035 * b.s, 0.013 * b.s, 0, Math.PI * 2);
  g.fill();

  // Speech bubble.
  const bubble = [roundRect(120, 770, 290, 96, 30), [[318, 772], [372, 704], [366, 776]]];
  dieCut(g, bubble, 16);
  inked(g, bubble, '#8fdcf0');
  centred(g, 'TWEET!', 265, 818, 40, 7, LINE);

  // Peeling label: cut the sticker along the fold, then draw the flap.
  const box = [640, 790, 260, 96];
  const turnLabel = (pts) => turn(pts, 770, 838, 0.07);
  const face = turnLabel(roundRect(box[0], box[1], box[2], box[3], 18));
  const outer = turnLabel(roundRect(box[0] - 16, box[1] - 16, box[2] + 32, box[3] + 32, 34));
  const [a, bb] = turnLabel([[box[0] + box[2] - 70, box[1] + box[3] + 16], [box[0] + box[2] + 16, box[1] + box[3] - 52]]);
  const sign = Math.sign((bb[0] - a[0]) * (838 - a[1]) - (bb[1] - a[1]) * (770 - a[0]));
  g.save();
  path(g, cutBy([[-50, -50], [W + 50, -50], [W + 50, H + 50], [-50, H + 50]], a, bb, sign));
  g.clip();
  dieCut(g, [face], 16);
  inked(g, [face], '#ff6b8b');
  centred(g, 'HELLO', 770, 838, 44, 8, '#ffffff');
  g.restore();
  const flap = cutBy(outer, a, bb, -sign).map((p) => mirror(p, a, bb));
  g.save();
  shadow(g, 'rgba(40, 30, 70, 0.35)', 12, -4, 6);
  const shade = g.createLinearGradient(a[0], a[1], flap[0][0], flap[0][1] + 40);
  shade.addColorStop(0, '#f6f3fb');
  shade.addColorStop(1, '#cfc7e2');
  g.fillStyle = shade;
  path(g, flap);
  g.fill();
  g.restore();

  caption(g, 'STICKER', font, 'rgba(95, 80, 150, 0.9)');
}

module.exports = { draw };
