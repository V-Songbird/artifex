// The print the drafting film makes: a sheet of watercolour paper brushed
// with cyanotype, lying on the table under the film. Where light reaches it
// the pale yellow-green coat turns a grey green; where the film's ink shades
// it, it stays as it was. Washed, the exposed coat turns Prussian blue and
// the shaded lines wash out to the paper's white: a blueprint, white lines on
// blue, the dark ground and light lines of a CAD drawing (see
// skills/artifex/styles/cad.md), on paper that can be cut and folded.
//
// THE COAT IS BRUSHED. Its edge runs in and out with the brush's strokes and
// the bare paper shows beyond it; the paper has its tooth and the table
// shows beyond the paper.
//
// All in the sheet's units (see draft.js).

'use strict';

const { rng, fbm } = require('../../core/rand.js');
const { span, ease } = require('../../core/time.js');
const Dr = require('./draft.js');
const Dy = require('./dry.js');

const WHITE = '#f1efe7';          // the watercolour paper
const COAT = '#dcdc9c';           // the cyanotype coat before light reaches it
const LATENT = '#8a9784';         // and after, before it is washed
const BLUE = '#1f3a69';           // washed: Prussian blue
const CLEARED = '#e6ebec';        // the shaded lines, washed out to the paper
const BLUE_RGBA = 'rgba(31, 58, 105, 1)', CLEARED_RGBA = 'rgba(230, 235, 236, 1)';
const TURNING = 110;              // how far behind the water the colours are still turning

const PAPER = [-150, -120, Dr.SW + 150, Dr.SH + 120];   // the paper's edges
const COATED = [-80, -65, Dr.SW + 80, Dr.SH + 65];      // where the brush laid the coat

// The print seam's camera: it draws back from the trace's to CLOSE over BACK
// seconds, about the bird, then drifts on back a little, so the frame never
// quite stops. The shots after the print begin from it.
const BACK = [0, 1.7];
const CLOSE = { c: [Dr.FRONT[0] + 45, Dr.FRONT[1] - 10], z: 1.9 };
const PRINTED = 239 / 30;                   // the print seam's last frame

/** The print seam's camera at its second `sec`. */
function printed(s, sec) {
  const from = Dr.look(s.traced);
  const v = Dr.towards(from, { ...CLOSE, turn: from.turn }, ease.inOut(span(BACK[0], BACK[1], sec)));
  v.z *= 1 - 0.02 * span(BACK[1], 8, sec);
  return v;
}

/** Build stage: the coat's brushed edge, the paper's tooth and the water's front. */
function coat(s) {
  const R = rng(s.seed);
  const edge = [];
  const [x0, y0, x1, y1] = COATED;
  // Round the coated rectangle, the edge pushed in and out by the brush.
  const side = (a, b, n, name) => {
    for (let i = 0; i < n; i++) {
      const u = i / n, x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u;
      const nx = b[1] - a[1], ny = -(b[0] - a[0]), l = Math.hypot(nx, ny);
      const d = (fbm(R, u * 9, 0.5, 3, 'coat' + name) - 0.5) * 34 + (R('coat', name, i) - 0.5) * 5;
      edge.push([x + (nx / l) * d, y + (ny / l) * d]);
    }
  };
  side([x0, y0], [x1, y0], 90, 'top');
  side([x1, y0], [x1, y1], 60, 'right');
  side([x1, y1], [x0, y1], 90, 'bottom');
  side([x0, y1], [x0, y0], 60, 'left');
  s.coat = edge;
  // The brush's passes: broad bands across the sheet, a little heavier or
  // lighter than the rest, and the bristles' streaks along them.
  s.passes = [];
  for (let i = 0, y = y0 - 20; y < y1 + 40; i++) {
    const w = 55 + R('pass', 'w', i) * 45, tilt = (R('pass', 'tilt', i) - 0.5) * 0.05;
    const heavy = R('pass', 'heavy', i) < 0.5, pts = [];
    for (let k = 0; k <= 12; k++) { const x = x0 - 40 + ((x1 - x0 + 80) * k) / 12; pts.push([x, y + (x - x0) * tilt + (fbm(R, k * 0.4, i, 2, 'pass') - 0.5) * 16]); }
    s.passes.push({ pts, w, heavy });
    y += w * (0.7 + R('pass', 'gap', i) * 0.4);
  }
  s.streaks = [];
  for (let i = 0; i < 90; i++) {
    const p = s.passes[Math.floor(R('streak', 'pass', i) * s.passes.length)];
    const off = (R('streak', 'off', i) - 0.5) * p.w, a = R('streak', 'from', i), l = 0.15 + R('streak', 'len', i) * 0.5;
    const pts = p.pts.filter((_, k) => k / 12 >= a && k / 12 <= a + l).map(([x, y]) => [x, y + off]);
    if (pts.length > 1) s.streaks.push(pts);
  }
  s.tooth = Array.from({ length: 520 }, (_, i) => [R('tooth', 'x', i) * TILE, R('tooth', 'y', i) * TILE, 0.9 + R('tooth', 'r', i) ** 2 * 1.5, R('tooth', 'lit', i) < 0.5]);
  // The water's front: a wave along it of its own, per seed.
  s.front = { phase: R('front', 'phase') * Math.PI * 2, tilt: (R('front', 'tilt') - 0.5) * 60 };
}

const TILE = 240;

// The tooth's tile per size in pixels: drawn once, laid as a pattern.
const tiles = new Map();

/** The paper's tooth over the whole paper: small bumps, lit and shaded, as a pattern at the surface's scale. */
function drawTooth(g, s) {
  const m = typeof g.getTransform === 'function' ? g.getTransform() : null;
  const k = m ? Math.hypot(m.a, m.b) : 1, px = Math.round(TILE * k);
  if (typeof OffscreenCanvas !== 'function' || typeof g.createPattern !== 'function' || !(px > 0)) return;
  let tile = tiles.get(px);
  if (!tile) {
    tile = new OffscreenCanvas(px, px);
    const tg = tile.getContext('2d');
    tg.scale(px / TILE, px / TILE);
    for (const [colour, lit] of [['rgba(20, 24, 30, 0.04)', false], ['rgba(255, 255, 255, 0.045)', true]]) {
      tg.fillStyle = colour;
      tg.beginPath();
      for (const [x, y, r, l] of s.tooth) if (l === lit) { tg.moveTo(x + r, y); tg.arc(x, y, r, 0, Math.PI * 2); }
      tg.fill();
    }
    tiles.set(px, tile);
  }
  const pattern = g.createPattern(tile, 'repeat');
  pattern.setTransform(new DOMMatrix([TILE / px, 0, 0, TILE / px, 0, 0]));
  g.fillStyle = pattern;
  g.fillRect(PAPER[0], PAPER[1], PAPER[2] - PAPER[0], PAPER[3] - PAPER[1]);
}

/** The brush's passes and streaks in the coat, over whatever colour it has turned. */
function drawBrush(g, s) {
  g.save();
  poly(g, s.coat);
  g.clip();
  g.lineCap = 'round';
  for (const heavy of [true, false]) {
    g.strokeStyle = heavy ? 'rgba(10, 20, 40, 0.06)' : 'rgba(255, 255, 250, 0.045)';
    for (const p of s.passes) {
      if (p.heavy !== heavy) continue;
      g.lineWidth = p.w * 0.55;
      g.beginPath();
      p.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(10, 20, 40, 0.06)';
  g.lineWidth = 1.4;
  g.beginPath();
  for (const pts of s.streaks) pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.restore();
}

function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/** Where the water's front lies at `u` (0 at the coat's top edge, 1 past its bottom), as a polyline across it. */
function frontAt(s, u, sec) {
  const pts = [];
  const top = 200, bottom = COATED[3] + 80;     // poured on from above the frame: the coat above it is washed already
  for (let x = PAPER[0]; x <= PAPER[2]; x += 24) {
    const v = (x - Dr.SW / 2) / Dr.SW;
    const wave = Math.sin(x / 95 + s.front.phase + sec * 2.2) * 14 + Math.sin(x / 37 - sec * 3.1) * 5;
    pts.push([x, top + (bottom - top) * u + wave + s.front.tilt * v - 40 * v * v]);
  }
  return pts;
}

/** The part of the plane behind front `pts` (towards the top), as a path. */
function behind(g, pts) {
  g.beginPath();
  g.moveTo(PAPER[0] - 50, PAPER[1] - 200);
  g.lineTo(PAPER[2] + 50, PAPER[1] - 200);
  for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/** `colour` (an rgba at alpha 1) as the water turns it: a third of the way at `front`, all of it a hand's breadth behind. */
function turning(g, front, colour) {
  const y = front.reduce((sum, p) => sum + p[1], 0) / front.length;
  const grad = g.createLinearGradient(0, y + 20, 0, y - TURNING);
  grad.addColorStop(0, colour.replace('1)', '0.3)'));
  grad.addColorStop(1, colour);
  return grad;
}

/**
 * The part of the sheet the water has washed at `wash`, filled black at the
 * alpha its colours have turned to: under 'destination-in', what lies there
 * is kept only as far as it is washed (see print.cjs).
 */
function soak(g, s, wash, sec) {
  const front = frontAt(s, wash, sec);
  behind(g, front);
  g.fillStyle = turning(g, front, 'rgba(0, 0, 0, 1)');
  g.fill();
}

/**
 * The table, the paper and its coat as they stand: exposed by `lit` (0 to
 * 1), and washed behind the water's front at `wash` (0, dry, to 1, all
 * washed), at second `sec` for the water's own movement, the water dried off
 * by `dry` (0 to 1).
 */
function drawSheet(g, s, lit, wash, sec, dry = 0) {
  g.save();
  // The table and the paper as paths: a browser drops what lies under an
  // opaque fillRect of the whole canvas, and a shot may prime its marks there.
  g.fillStyle = Dy.TABLE;
  g.beginPath();
  g.rect(PAPER[0] - 900, PAPER[1] - 700, PAPER[2] - PAPER[0] + 1800, PAPER[3] - PAPER[1] + 1400);
  g.fill();
  // The paper, with a soft contact shadow where it lies on the table.
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.beginPath();
  g.rect(PAPER[0] + 3, PAPER[1] + 5, PAPER[2] - PAPER[0], PAPER[3] - PAPER[1]);
  g.fill();
  g.fillStyle = WHITE;
  g.beginPath();
  g.rect(PAPER[0], PAPER[1], PAPER[2] - PAPER[0], PAPER[3] - PAPER[1]);
  g.fill();
  // The coat, exposed as far as the light has reached it, and washed behind
  // the water; once all of it is washed, only the blue and the cleared lines
  // show, and only they are drawn.
  if (wash >= 1) {
    poly(g, s.coat);
    g.fillStyle = BLUE;
    g.fill();
    Dr.drawLines(g, s, CLEARED, 1.15);
  } else {
    poly(g, s.coat);
    g.fillStyle = COAT;
    g.fill();
    if (lit > 0) {
      g.globalAlpha = lit;
      g.fillStyle = LATENT;
      g.fill();
      // The film's lines shaded the coat: there it is as it was.
      Dr.drawLines(g, s, COAT, 1.15);
      g.globalAlpha = 1;
    }
    if (wash > 0) {
      // Behind the front the coat turns blue and the lines clear.
      const front = frontAt(s, wash, sec);
      g.save();
      behind(g, front);
      g.clip();
      poly(g, s.coat);
      g.fillStyle = turning(g, front, BLUE_RGBA);
      g.fill();
      Dr.drawLines(g, s, turning(g, front, CLEARED_RGBA), 1.15);
      g.restore();
    }
  }
  drawBrush(g, s);
  drawTooth(g, s);
  // The water: wet paper darker just ahead of it, its lit edge, and the sheen behind.
  if (wash > 0 && dry < 1) drawWater(g, frontAt(s, wash, sec), sec, 1 - dry);
  g.restore();
}

/** The water's edge along `front`, and the light on the wet sheet behind it. */
function drawWater(g, front, sec, wet) {
  g.save();
  g.globalAlpha = wet;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const line = (pts, dy, colour, width) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)));
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.stroke();
  };
  line(front, 6, 'rgba(20, 30, 50, 0.10)', 12);
  line(front, 0, 'rgba(255, 255, 255, 0.55)', 2.2);
  line(front, -5, 'rgba(255, 255, 255, 0.18)', 6);
  // The sheen: broad soft light lying on the water, moving with it.
  g.save();
  behind(g, front);
  g.clip();
  const y = front[Math.floor(front.length / 2)][1];
  for (let k = 0; k < 3; k++) {
    const cx = 200 + k * 380 + Math.sin(sec * 0.7 + k * 2.1) * 60, cy = y - 140 - k * 90;
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 260);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = glow;
    g.fillRect(cx - 260, cy - 260, 520, 520);
  }
  g.restore();
  g.restore();
}

module.exports = { printed, CLOSE, PRINTED, coat, drawSheet, drawWater, frontAt, soak, PAPER, COATED, BLUE, CLEARED, WHITE };
