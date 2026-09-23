// Papercraft: a torn-paper night collage. Sky strips torn along their lower
// edges show the paper's white core and cast soft shadows; the bird is cut
// clean, because scissors made it.

'use strict';

const { rng, noise2 } = require('../../../core/rand.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, star, grain, shadow, caption } = require('./kit.js');

const W = 1000; const H = 1000;

// A strip hanging from the top edge, torn along y0.
function tornStrip(g, R, name, y0, amp, fill) {
  const edge = [];
  for (let i = 0; i <= 140; i++) {
    const x = -40 + (W + 80) * (i / 140);
    const wave = (noise2(R, x / 240, 0.5, name + 'wave') - 0.5) * amp * 4;
    const jag = (noise2(R, x / 14, 3.5, name + 'jag') - 0.5) * amp + (R(name, 'j', i) - 0.5) * amp * 0.5;
    edge.push([x, y0 + wave + jag]);
  }
  const outline = (lift) => {
    g.beginPath();
    g.moveTo(-40, -40);
    g.lineTo(W + 40, -40);
    for (let i = edge.length - 1; i >= 0; i--) g.lineTo(edge[i][0], edge[i][1] + lift(i));
    g.closePath();
  };
  // The white core, with the strip's shadow on whatever lies beneath.
  g.save();
  shadow(g, 'rgba(4, 6, 24, 0.55)', 18, 0, 7);
  g.fillStyle = '#eee8dc';
  outline((i) => 3 + noise2(R, i * 0.35, 9.1, name + 'rim') * 9);
  g.fill();
  g.restore();
  g.fillStyle = fill;
  outline(() => 0);
  g.fill();
  // Mottle, so a strip reads as one sheet of paper rather than a fill.
  g.save();
  outline(() => 0);
  g.clip();
  for (let i = 0; i < 40; i++) {
    g.fillStyle = R(name, 'mt', i) < 0.5 ? 'rgba(255,255,255,0.016)' : 'rgba(0,0,20,0.03)';
    g.beginPath();
    g.arc(R(name, 'mx', i) * W, R(name, 'my', i) * y0, 30 + R(name, 'mr', i) * 60, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// Cursive-looking scribble rows, the handwriting printed on some papers.
function script(g, R, name, x0, y0, x1, y1, colour) {
  g.strokeStyle = colour;
  g.lineWidth = 1.4;
  for (let y = y0 + 14, row = 0; y < y1; y += 17, row++) {
    g.beginPath();
    let x = x0 + R(name, 'in', row) * 20;
    g.moveTo(x, y);
    while (x < x1) {
      const loop = 4 + R(name, 'lp', Math.floor(x) + row * 997) * 5;
      g.quadraticCurveTo(x + loop * 0.5, y - loop * 1.3, x + loop, y);
      x += loop;
      if (R(name, 'gap', Math.floor(x) + row * 991) < 0.12) { x += 8; g.moveTo(x, y); }
    }
    g.stroke();
  }
}

function house(g, R, i, x, w, h, roof, fill) {
  const base = H + 30;
  const top = base - h;
  const outline = [[x, base], [x, top], [x + w / 2, top - roof], [x + w, top], [x + w, base]];
  g.save();
  shadow(g, 'rgba(4, 6, 24, 0.5)', 14, 5, 5);
  g.fillStyle = fill;
  path(g, outline);
  g.fill();
  g.restore();
  g.save();
  path(g, outline);
  g.clip();
  script(g, R, 'house' + i, x, top - roof, x + w, base, 'rgba(255,255,255,0.08)');
  g.restore();
  // Roof edge: a thin darker paper strip laid over the gable.
  g.strokeStyle = 'rgba(10,8,35,0.55)';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  path(g, [[x - 8, top + 6], [x + w / 2, top - roof], [x + w + 8, top + 6]], false);
  g.stroke();
  const rows = Math.max(1, Math.floor((h - 70) / 90));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      const lit = R('window', 'lit', i * 10 + r * 2 + c) < 0.7;
      const wx = x + w * (c ? 0.62 : 0.2); const wy = top + 38 + r * 90;
      g.fillStyle = lit ? '#f5c24c' : '#1f1d46';
      g.fillRect(wx, wy, w * 0.18, 44);
      g.strokeStyle = lit ? '#b8791f' : '#15133a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(wx + w * 0.09, wy); g.lineTo(wx + w * 0.09, wy + 44);
      g.moveTo(wx, wy + 22); g.lineTo(wx + w * 0.18, wy + 22);
      g.stroke();
    }
  }
}

function draw(g, s) {
  const R = rng(s.seed);

  g.fillStyle = '#34418a';
  g.fillRect(0, 0, W, H);
  tornStrip(g, R, 'low', 640, 16, '#28337a');
  tornStrip(g, R, 'mid', 430, 14, '#212b66');
  tornStrip(g, R, 'high', 210, 12, '#1a2253');

  // Newsprint crescent moon.
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.arc(282, 150, 70, 0, Math.PI * 2);
  g.clip('evenodd');
  g.save();
  shadow(g, 'rgba(4, 6, 24, 0.5)', 12, 0, 5);
  g.fillStyle = '#efe5c8';
  g.beginPath();
  g.arc(240, 170, 78, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(240, 170, 78, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = 'rgba(80,70,60,0.35)';
  for (let row = 0; row < 16; row++) {
    for (let x = 150; x < 330;) {
      const word = 8 + R('news', 'w', row * 40 + Math.floor(x)) * 22;
      g.fillRect(x, 96 + row * 9.5, word, 2.2);
      x += word + 5;
    }
  }
  g.restore();

  // Paper stars and thin cream sparkles.
  for (let i = 0; i < 22; i++) {
    const x = 40 + R('star', 'x', i) * 920; const y = 40 + R('star', 'y', i) * 560;
    if (Math.hypot(x - 240, y - 170) < 120 || Math.hypot(x - 560, y - 470) < 240) continue;
    const r = 7 + R('star', 'r', i) * 9;
    g.save();
    shadow(g, 'rgba(4, 6, 24, 0.5)', 6, 0, 3);
    g.fillStyle = '#f3d27c';
    g.lineJoin = 'round';
    path(g, star(x, y, r, 5, 0.45, -Math.PI / 2 + R('star', 'a', i) * 0.6));
    g.fill();
    g.restore();
  }
  g.strokeStyle = 'rgba(244,236,214,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const x = 30 + R('spark', 'x', i) * 940; const y = 30 + R('spark', 'y', i) * 600;
    const r = 5 + R('spark', 'r', i) * 5;
    g.beginPath();
    g.moveTo(x - r, y); g.lineTo(x + r, y);
    g.moveTo(x, y - r); g.lineTo(x, y + r);
    g.stroke();
  }

  const b = bird(570, 470, 200, -0.14);
  // The bird's flight, dashed like a paper plane's, ending at its tail.
  const tailEnd = b.at([[-1.25, -0.2]])[0];
  g.save();
  g.strokeStyle = 'rgba(243,236,220,0.85)';
  g.lineWidth = 3.5;
  g.setLineDash([14, 13]);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(30, 640);
  g.bezierCurveTo(150, 470, 230, 640, tailEnd[0], tailEnd[1]);
  g.stroke();
  g.restore();

  const shadowed = (fill, pts) => {
    g.save();
    shadow(g, 'rgba(3, 5, 25, 0.55)', 16, 8, 11);
    g.fillStyle = fill;
    path(g, pts);
    g.fill();
    g.restore();
  };
  shadowed('#d8634b', b.tail);
  shadowed('#f6f1e6', b.body);
  // Faint fibres in the cream paper.
  g.save();
  path(g, b.body);
  g.clip();
  g.strokeStyle = 'rgba(150,130,100,0.10)';
  g.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    const x = 400 + R('fibre', 'x', i) * 380; const y = 320 + R('fibre', 'y', i) * 300;
    const a = R('fibre', 'a', i) * Math.PI;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10 + 4, x + Math.cos(a) * 22, y + Math.sin(a) * 22);
    g.stroke();
  }
  g.restore();
  shadowed('#f0a442', b.beak);
  shadowed('#e9806e', b.wing);
  // A fold down the wing.
  g.strokeStyle = 'rgba(140,50,35,0.35)';
  g.lineWidth = 2;
  const fold = b.at([[0.2, -0.08], [-0.2, -0.13], [-0.58, -0.22]]);
  path(g, fold, false);
  g.stroke();
  g.fillStyle = 'rgba(242,140,140,0.75)';
  g.beginPath();
  g.arc(b.cheek[0], b.cheek[1], 0.075 * b.s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a2238';
  g.beginPath();
  g.arc(b.eye[0], b.eye[1], 0.055 * b.s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(b.eye[0] + 3, b.eye[1] - 3, 3.2, 0, Math.PI * 2);
  g.fill();

  // Rooftops along the bottom, each its own sheet.
  const colours = ['#3a2f6d', '#2b2a5e', '#45337a', '#262a58', '#3d3272'];
  let x = -30;
  for (let i = 0; x < W; i++) {
    const w = 160 + R('house', 'w', i) * 80;
    const h = 190 + R('house', 'h', i) * 150;
    house(g, R, i, x, w, h, 60 + R('house', 'roof', i) * 40, colours[i % colours.length]);
    x += w - 18;
  }

  grain(g, R, 'grain', W, H, 7000, 'rgba(255,255,255,0.05)', 'rgba(0,0,10,0.08)');
  caption(g, 'PAPERCRAFT', font, 'rgba(239,230,210,0.85)');
}

module.exports = { draw };
