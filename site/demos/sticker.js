// The showcase site's demo of Sticker: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/sticker.js. Site-only, never
// a starting point for a piece. Die-cut stickers lie on a cutting mat: the
// bird, a star with a face, a musical note, a speech bubble and a label that
// is peeling, its corner folded back to show the backing.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, ellipse, star, caption } = require('../../skills/artifex/styles/kit.js');
const { LINE, mat, dieCut, inked, gloss, eye, lettering, roundRect, peel } = require('../../skills/artifex/styles/sticker.js');

const W = 1000; const H = 1000;

function turn(pts, cx, cy, a) {
  const c = Math.cos(a); const s = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

function draw(g, s) {
  const R = rng(s.seed);
  const border = (s.params && s.params.border) ?? 26;

  mat(g, R, W, H);

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
  dieCut(g, [b.tail, b.body, b.wing, b.beak], border);
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
  // The gloss streak, inside the body's clip and under its outline, so it
  // stays on the vinyl.
  const hl = b.at([[0.17, -0.45], [0.24, -0.56], [0.38, -0.59]]);
  gloss(g, hl[0], hl[1], hl[2]);
  g.restore();
  g.strokeStyle = LINE;
  g.lineWidth = 7;
  g.lineJoin = 'round';
  path(g, b.body);
  g.stroke();
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
  eye(g, b.eye[0], b.eye[1], b.s);

  // Speech bubble.
  const bubble = [roundRect(120, 770, 290, 96, 30), [[318, 772], [372, 704], [366, 776]]];
  dieCut(g, bubble, 16);
  inked(g, bubble, '#8fdcf0');
  lettering(g, 'TWEET!', 265, 818, 40, 7, LINE);

  // Peeling label: cut the sticker along the fold, then draw the flap.
  const box = [640, 790, 260, 96];
  const turnLabel = (pts) => turn(pts, 770, 838, 0.07);
  const face = turnLabel(roundRect(box[0], box[1], box[2], box[3], 18));
  const outer = turnLabel(roundRect(box[0] - 16, box[1] - 16, box[2] + 32, box[3] + 32, 34));
  const [a, bb] = turnLabel([[box[0] + box[2] - 70, box[1] + box[3] + 16], [box[0] + box[2] + 16, box[1] + box[3] - 52]]);
  peel(g, { outer, a, b: bb, keep: [770, 838], w: W, h: H }, () => {
    dieCut(g, [face], 16);
    inked(g, [face], '#ff6b8b');
    lettering(g, 'HELLO', 770, 838, 44, 8, '#ffffff');
  });

  caption(g, 'STICKER', font, 'rgba(95, 80, 150, 0.9)');
}

module.exports = {
  name: 'sticker', size: { w: 1000, h: 1000 }, seed: 2026,
  params: { border: { min: 8, max: 44, value: 26, meaning: 'Width of the white vinyl border die-cut round the bird: low trims it close, high leaves a wide margin' } },
  draw,
};
