// The showcase site's demo of Papercraft: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/papercraft.js. Site-only,
// never a starting point for a piece. A torn-paper night collage: sky strips
// torn along their lower edges, a newsprint crescent, paper stars, the bird
// cut clean, and rooftops along the bottom.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, star, grain, shadow, caption } = require('../../skills/artifex/styles/kit.js');
const { tornEdge, tornSheet, cutSheet, fibres, fold, script, newsprint } = require('../../skills/artifex/styles/papercraft.js');

const W = 1000; const H = 1000;

// A strip hanging from the top edge, torn along y0.
function tornStrip(g, R, name, y0, amp, fill) {
  const edge = tornEdge(R, name, -40, W + 40, y0, amp);
  tornSheet(g, R, name, edge, [[-40, -40], [W + 40, -40]], fill, { mottle: [0, 0, W, y0] });
}

function house(g, R, i, x, w, h, roof, fill) {
  const base = H + 30;
  const top = base - h;
  const outline = [[x, base], [x, top], [x + w / 2, top - roof], [x + w, top], [x + w, base]];
  cutSheet(g, outline, fill, { shade: ['rgba(4, 6, 24, 0.5)', 14, 5, 5] });
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

  // Each layer a clear step darker than the one beneath it.
  g.fillStyle = '#44529f';
  g.fillRect(0, 0, W, H);
  tornStrip(g, R, 'low', 640, 16, '#323e88');
  tornStrip(g, R, 'mid', 430, 14, '#242d6c');
  tornStrip(g, R, 'high', 210, 12, '#181e4e');

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
  newsprint(g, R, 'news', 150, 96, 330, 16);
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

  cutSheet(g, b.tail, '#d8634b');
  cutSheet(g, b.body, '#f6f1e6');
  // Faint fibres in the cream paper.
  g.save();
  path(g, b.body);
  g.clip();
  fibres(g, R, 'fibre', 400, 320, 380, 300);
  g.restore();
  cutSheet(g, b.beak, '#f0a442');
  cutSheet(g, b.wing, '#e9806e');
  // A fold down the wing.
  fold(g, b.at([[0.2, -0.08], [-0.2, -0.13], [-0.58, -0.22]]));
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

module.exports = { name: 'papercraft', size: { w: 1000, h: 1000 }, seed: 2026, draw };
