// A film that goes nearly empty on purpose, for calibrating the time strip's
// flags (tools/contact-sheet.js): discs of many tones drift over a grey ground,
// except from 3.5 to 4.5 s, when only the ground is left, darkening to its
// edges, and from 7.5 to 8.5 s, when fine ruled lines cover the whole frame
// evenly with no subject, rich at full size and flat at 1/8. From 11 s the
// discs stop and the frame holds to the end. `npm run seeds --
// tests/fixtures/empty-film.cjs --frames 11` shows each. Never show it to anyone.

'use strict';

const { rng } = require('../../core/rand.js');

const W = 960;
const H = 540;

module.exports = {
  name: 'empty-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 20, hz: 12 },
  build: [['discs', (s) => {
    const R = rng(s.seed);
    s.discs = Array.from({ length: 40 }, (_, i) => ({
      x: R('disc', 'x', i) * W, y: R('disc', 'y', i) * H, r: 20 + R('disc', 'r', i) * 60,
      vx: (R('disc', 'vx', i) - 0.5) * 80, vy: (R('disc', 'vy', i) - 0.5) * 60, tone: Math.round(R('disc', 'tone', i) * 255),
    }));
  }]],
  draw(g, s, t, clock) {
    const seconds = clock.frame / 12;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, W, H);
    if (seconds >= 3.5 && seconds < 4.5) {
      const shade = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = shade;
      g.fillRect(0, 0, W, H);
      return;
    }
    if (seconds >= 7.5 && seconds < 8.5) {
      g.strokeStyle = '#202020';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= W + H; x += 3) { g.moveTo(x, 0); g.lineTo(x - H, H); }
      g.stroke();
      return;
    }
    const at = Math.min(seconds, 11);
    for (const d of s.discs) {
      const x = ((d.x + d.vx * at) % W + W) % W, y = ((d.y + d.vy * at) % H + H) % H;
      g.fillStyle = `rgb(${d.tone},${d.tone},${255 - d.tone})`;
      g.beginPath();
      g.arc(x, y, d.r, 0, Math.PI * 2);
      g.fill();
    }
  },
};
