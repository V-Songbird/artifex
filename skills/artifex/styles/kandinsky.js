// Kandinsky: the bird as a geometric abstraction on warm paper. A haloed
// circle for the head, concentric rings for the eye, a triangle beak, a half
// disc body under a glazed circle, a rainbow of arcs for the wing, bars, a
// chequer strip and fanned lines for the tail, thin crossing lines, a ruler
// perch, and small floating forms. Overlaps multiply like glazes.

'use strict';

const { rng } = require('../../../core/rand.js');
const font = require('../../../core/stroke-font.js');
const { path, grain, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const K = {
  paper: '#efe8d8', black: '#1b1b1f', red: '#d8412f', vermilion: '#e0452b', yellow: '#f2c14e',
  ochre: '#d9a441', blue: '#2f5fa7', deep: '#23407a', teal: '#3fa9a2', pink: '#e98aa6',
  green: '#5a9e5a', violet: '#7b5ea7', orange: '#ec8a2f',
};

function disc(g, x, y, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function halo(g, x, y, r0, r1, rgb, alpha) {
  const h = g.createRadialGradient(x, y, r0, x, y, r1);
  h.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  h.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = h;
  g.beginPath();
  g.arc(x, y, r1, 0, Math.PI * 2);
  g.fill();
}

function line(g, a, b, width, colour = K.black, cap = 'butt') {
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = cap;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
}

function draw(g, s) {
  const R = rng(s.seed);

  g.fillStyle = K.paper;
  g.fillRect(0, 0, W, H);
  const vig = g.createRadialGradient(500, 500, 300, 500, 500, 760);
  vig.addColorStop(0, 'rgba(120, 95, 60, 0)');
  vig.addColorStop(1, 'rgba(120, 95, 60, 0.16)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);

  // Halos first: they sit under everything like washes.
  halo(g, 620, 370, 60, 250, '242, 193, 78', 0.35);
  halo(g, 190, 190, 20, 95, '216, 65, 47', 0.35);
  halo(g, 430, 600, 80, 260, '47, 95, 167', 0.14);

  // Long crossing lines.
  g.strokeStyle = K.black;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(520, 900, 700, -2.62, -0.86);
  g.stroke();
  line(g, [90, 300], [380, 140], 7);
  line(g, [690, 610], [955, 515], 2.5);
  line(g, [70, 930], [300, 700], 2.5);

  g.save();
  g.globalCompositeOperation = 'multiply';

  // Body: a half disc, and a pink glaze circle across it.
  const bodyGrad = g.createLinearGradient(330, 480, 560, 740);
  bodyGrad.addColorStop(0, '#5b86c5');
  bodyGrad.addColorStop(1, K.blue);
  g.fillStyle = bodyGrad;
  g.beginPath();
  g.arc(460, 560, 190, -0.35, Math.PI - 0.35);
  g.closePath();
  g.fill();
  disc(g, 395, 615, 118, 'rgba(233, 138, 166, 0.85)');

  // Wing: a rainbow of arcs over the body.
  const bands = [K.violet, K.blue, K.green, K.yellow, K.orange, K.red];
  g.lineCap = 'butt';
  bands.forEach((c, i) => {
    g.strokeStyle = c;
    g.lineWidth = 15;
    g.beginPath();
    g.arc(420, 560, 72 + i * 15, Math.PI + 0.22, Math.PI * 2 - 0.4);
    g.stroke();
  });

  // Head: a circle graded like light on paper.
  const head = g.createRadialGradient(585, 335, 10, 620, 370, 118);
  head.addColorStop(0, '#fbe3a0');
  head.addColorStop(0.6, K.yellow);
  head.addColorStop(1, '#e0a93a');
  disc(g, 620, 370, 116, head);

  // Beak.
  g.fillStyle = K.vermilion;
  path(g, [[712, 362], [884, 402], [718, 428]]);
  g.fill();
  g.restore();

  g.strokeStyle = K.black;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(620, 370, 128, -1.25, 1.55);
  g.stroke();

  // Eye: rings inside rings.
  disc(g, 655, 345, 44, '#fbf7ee');
  g.strokeStyle = K.red;
  g.lineWidth = 11;
  g.beginPath();
  g.arc(655, 345, 31, 0, Math.PI * 2);
  g.stroke();
  disc(g, 655, 345, 16, K.black);
  disc(g, 661, 339, 5, '#fbf7ee');

  // The song: a line out of the beak ending in a small ring.
  line(g, [884, 402], [948, 418], 3);
  g.strokeStyle = K.black;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(956, 420, 8, 0, Math.PI * 2);
  g.stroke();

  // Tail: a heavy bar, fanned lines and a chequer strip.
  line(g, [292, 500], [118, 398], 24);
  for (const end of [[108, 470], [118, 522], [150, 578]]) line(g, [300, 522], end, 3);
  const ang = Math.atan2(398 - 500, 118 - 292);
  g.save();
  g.translate(250, 520);
  g.rotate(ang);
  for (let k = 0; k < 9; k++) {
    for (let j = 0; j < 2; j++) {
      g.fillStyle = (k + j) % 2 ? K.black : '#fbf7ee';
      g.fillRect(k * 14, j * 14, 14, 14);
    }
  }
  g.strokeStyle = K.black;
  g.lineWidth = 2;
  g.strokeRect(0, 0, 126, 28);
  g.restore();

  // Legs and a ruler perch.
  line(g, [442, 742], [422, 866], 4);
  line(g, [522, 738], [532, 866], 4);
  disc(g, 422, 868, 9, K.black);
  disc(g, 532, 868, 9, K.black);
  line(g, [150, 880], [890, 850], 3);
  for (let x = 620; x <= 880; x += 16) {
    const y = 880 - ((x - 150) / 740) * 30;
    line(g, [x, y - 9], [x, y + 9], 2);
  }

  // Floating forms.
  disc(g, 190, 190, 34, K.red);
  disc(g, 200, 182, 9, K.black);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = K.teal;
  path(g, [[776, 214], [872, 116], [884, 236]]);
  g.fill();
  g.fillStyle = 'rgba(242, 193, 78, 0.9)';
  g.beginPath();
  g.arc(862, 780, 58, Math.PI, Math.PI * 2);
  g.closePath();
  g.fill();
  g.restore();
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.arc(268, 318, 38, 0, Math.PI * 2);
  g.clip('evenodd');
  disc(g, 250, 326, 42, K.green);
  g.restore();
  g.strokeStyle = K.black;
  g.lineWidth = 2;
  for (let k = 0; k <= 4; k++) {
    line(g, [760 + k * 22, 620], [760 + k * 22, 708], 2);
    line(g, [760, 620 + k * 22], [848, 620 + k * 22], 2);
  }
  g.strokeStyle = K.blue;
  g.lineWidth = 8;
  g.beginPath();
  g.arc(150, 700, 30, 0, Math.PI * 2);
  g.stroke();
  disc(g, 150, 700, 12, K.red);
  for (let i = 0; i < 7; i++) {
    disc(g, 90 + R('dot', 'x', i) * 820, 90 + R('dot', 'y', i) * 820, 3 + R('dot', 'r', i) * 5, K.black);
  }

  grain(g, R, 'grain', W, H, 6000, 'rgba(255,255,250,0.12)', 'rgba(90,70,40,0.07)');
  caption(g, 'KANDINSKY', font, 'rgba(27, 27, 31, 0.8)');
}

module.exports = { draw };
