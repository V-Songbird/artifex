// The product page's teaching piece: a pen lays lines across a sheet, each
// riding the same slow swell, so one piece can show what a seed, a playhead,
// parameters, a box and the exports each do.
//
// The page shows the regions marked `// @site <name>` beside the widget that
// teaches them, cut from this file at build time, so the code a visitor reads
// is the code that draws.

'use strict';

const { rng } = require('../../core/rand.js');

const INK = '#1d1a2e';
const PAPER = '#f6efe2';
const STEPS = 120;          // points along each line
const TAU = Math.PI * 2;

module.exports = {
  name: 'site-tides',
  size: { w: 900, h: 560 },
  // @site exports
  outputs: ['raster', 'vector'],
  // @site end
  seed: 7,
  // @site box
  boxes: { w: [360, 1600], h: [360, 900] },
  // @site end
  // @site playhead
  time: { duration: 6, hz: 30 },
  // @site end
  // @site params
  params: {
    lines: { min: 6, max: 42, value: 22, meaning: 'how many lines the pen lays across the sheet' },
    swell: { min: 0, max: 1, value: 0.55, meaning: 'how far each line rises and falls with the swell' },
  },
  // @site end

  build: [
    // @site seed
    ['choose the swell', (s) => {
      const R = rng(s.seed);
      s.waves = [0, 1, 2].map((k) => ({ f: 1.2 + R('swell', 'f', k) * 2.6, phase: R('swell', 'phase', k) * TAU, amp: 0.4 + R('swell', 'amp', k) * 0.6 }));
      // Two inks, a third of the wheel apart; the lines pass from one to the other down the sheet.
      s.hue = Math.floor(R('ink', 'hue') * 360);
      s.turn = 80 + R('ink', 'turn') * 80;
      s.accent = Math.floor(R('ink', 'accent') * 1000);
    }],
    // @site end
    ['lay out the lines', (s) => {
      const R = rng(s.seed), n = Math.round(s.params.lines);
      s.lines = [];
      for (let i = 0; i < n; i++) {
        s.lines.push({ row: (i + 0.5) / n, lag: R('line', 'lag', i) * 0.35, weight: 1.8 + R('line', 'weight', i) * 2.6, accent: i === s.accent % n });
      }
    }],
  ],

  draw(g, s, t) {
    const { w, h } = s.box, sec = t * 6;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    s.lines.forEach((line, i) => {
      // The pen draws each line from the left, a little after the one before: arc length grows.
      const last = Math.round(Math.max(0, Math.min(1, (t * 1.25 - line.lag) / 0.8)) * STEPS);
      if (last < 1) return;
      const y0 = h * (0.12 + 0.76 * line.row);
      // Saturated ink, deeper at the heavy lines; the accent line is the ink itself, at full strength.
      const hue = Math.round(s.hue + s.turn * line.row);
      g.strokeStyle = line.accent ? INK : 'hsl(' + hue + ' ' + (62 + line.weight * 5) + '% ' + (52 - line.weight * 4) + '%)';
      g.lineWidth = line.accent ? line.weight + 1.6 : line.weight;
      g.beginPath();
      for (let j = 0; j <= last; j++) {
        const u = j / STEPS;
        // The swell keeps moving under the lines, slowly, to the last frame.
        let d = 0;
        for (const v of s.waves) d += v.amp * Math.sin(v.f * u * TAU + v.phase + i * 0.21 + sec * 0.35);
        const x = w * (0.06 + 0.88 * u), y = y0 + d * s.params.swell * h * 0.09 * Math.sin(Math.PI * u);
        if (j) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    });
  },
};
