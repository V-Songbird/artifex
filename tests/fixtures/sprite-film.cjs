// A sprite-heavy film for measuring core/layer.js's sprites: sixty textured
// cutouts of twelve kinds, each a seeded blob with a shadow, a hatched and
// stippled texture and a rim, drifting, turning and scaling over a sheet that
// gains a settled mark every frame. Every cutout is a sprite baked once per
// solve and device scale, at twice the device scale where it grows past its
// own size, so it is never resampled up; the sheet is a keyed sprite grown from its copy of
// the frame before. The `keep` parameter set to 0 keeps no copy, so every
// sprite is baked afresh on every draw: the frames must not change. `direct`
// set to 1 uses no sprite at all and paints every cutout and every settled mark
// onto the frame, as a piece without sprites would; its antialiasing differs.

'use strict';

const { rng } = require('../../core/rand.js');
const { layer, sprite, held } = require('../../core/layer.js');

const W = 960;
const H = 540;
const KINDS = 12;
const CUTOUTS = 60;
const R = 40;                        // a cutout's radius in design units
const BOX = [-R - 6, -R - 6, 2 * R + 16, 2 * R + 16];
const MARKS_PER_FRAME = 8;

module.exports = {
  name: 'sprite-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 4, hz: 24 },
  params: {
    keep: { min: 0, max: 1, value: 1, meaning: '1 keeps sprite copies between frames, 0 bakes every sprite afresh; the picture is the same' },
    direct: { min: 0, max: 1, value: 0, meaning: '1 paints every cutout and mark onto the frame with no sprite, for timing' },
  },
  build: [['cutouts', (s) => {
    const r = rng(s.seed);
    s.kinds = Array.from({ length: KINDS }, (_, k) => {
      const outline = Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2, d = R * (0.7 + 0.3 * r('kind ' + k, 'outline', i));
        return [Math.cos(a) * d, Math.sin(a) * d];
      });
      const hatch = Array.from({ length: 220 }, (_, i) => [(r('kind ' + k, 'hx', i) - 0.5) * 2 * R, (r('kind ' + k, 'hy', i) - 0.5) * 2 * R, r('kind ' + k, 'ha', i) * 0.6 + 0.6]);
      const dots = Array.from({ length: 160 }, (_, i) => [(r('kind ' + k, 'dx', i) - 0.5) * 2 * R, (r('kind ' + k, 'dy', i) - 0.5) * 2 * R, 0.4 + r('kind ' + k, 'dr', i) * 1.2]);
      return { outline, hatch, dots, hue: Math.floor(r('kind ' + k, 'hue', 0) * 360) };
    });
    s.paths = Array.from({ length: CUTOUTS }, (_, i) => ({
      kind: i % KINDS, x: r('path', 'px', i) * W, y: r('path', 'py', i) * H, vx: (r('path', 'vx', i) - 0.5) * 60, vy: (r('path', 'vy', i) - 0.5) * 40,
      turn: (r('path', 'turn', i) - 0.5) * 1.5, scale: 0.6 + r('path', 'scale', i) * 0.8,
    }));
    s.marks = Array.from({ length: 96 * MARKS_PER_FRAME }, (_, i) => [r('mark', 'mx', i) * W, r('mark', 'my', i) * H, 1 + r('mark', 'mr', i) * 3, r('mark', 'mc', i)]);
    // So a check in the page can read what the copies hold.
    s.held = held;
  }]],
  draw(g, s, t, clock) {
    const budget = s.params.keep ? undefined : 0;
    // A sprite, or with `direct` its paint straight onto the frame under `at`.
    const place = s.params.direct
      ? (name, box, paint, { key = 0, at }) => { g.save(); if (at) g.transform(...at); paint(g, s, null, key); g.restore(); }
      : (name, box, paint, opt) => sprite(g, s, name, box, paint, opt);
    layer(g, s, 'paper', [0, 0, W, H], (lg) => { lg.fillStyle = '#efe6d2'; lg.fillRect(0, 0, W, H); });
    place('sheet', [0, 0, W, H], (sg, st, from, to) => {
      for (let i = from === null ? 0 : from; i < to; i++) {
        const [x, y, rr, c] = st.marks[i];
        sg.fillStyle = c < 0.5 ? 'rgba(90, 70, 50, 0.35)' : 'rgba(40, 70, 110, 0.3)';
        sg.beginPath(); sg.arc(x, y, rr, 0, Math.PI * 2); sg.fill();
      }
    }, { key: (clock.frame + 1) * MARKS_PER_FRAME, budget });
    for (const p of s.paths) {
      const a = p.turn * t, k = p.scale * (1 + 0.15 * Math.sin(t * 2 + p.x));
      const at = [k * Math.cos(a), k * Math.sin(a), -k * Math.sin(a), k * Math.cos(a), p.x + p.vx * t, p.y + p.vy * t];
      place('cutout ' + p.kind, BOX, (sg, st) => cutout(sg, st.kinds[p.kind]), { at, budget, scale: p.scale * 1.15 > 1 ? 2 : 1 });
    }
  },
};

/** One cutout: its shadow, its body, a texture of hatching and stipple inside it, and a rim. */
function cutout(g, kind) {
  const trace = (dx, dy) => {
    g.beginPath();
    kind.outline.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
    g.closePath();
  };
  trace(5, 6);
  g.fillStyle = 'rgba(30, 20, 10, 0.3)';
  g.fill();
  trace(0, 0);
  g.fillStyle = `hsl(${kind.hue} 45% 55%)`;
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = `hsl(${kind.hue} 40% 30% / 0.5)`;
  g.lineWidth = 0.6;
  g.beginPath();
  for (const [x, y, a] of kind.hatch) { g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); }
  g.stroke();
  g.fillStyle = `hsl(${kind.hue} 50% 85% / 0.45)`;
  for (const [x, y, r] of kind.dots) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.restore();
  trace(0, 0);
  g.strokeStyle = 'rgba(255, 250, 235, 0.8)';
  g.lineWidth = 1.5;
  g.stroke();
}
