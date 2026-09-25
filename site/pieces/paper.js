// The sheet the site's first shots share: a drawing paper with a fine tooth,
// the light across it, and the one ink everything on it is drawn in.
//
// THE TOOTH BELONGS TO THE PAPER. Its texture is a field of small bumps, each
// lit on the side the light comes from and shaded on the other, painted once
// with the sheet. It is not a grain laid over the finished frame: the ink and
// the water lie in it.
//
// ONE INK. Every mark is the same ink at some concentration, never a hue picked
// on the wheel. A concentration is a Beer-Lambert filter over the paper, per
// channel in linear light: `tone(c)` is the colour it leaves on bare paper, and
// `wash(c)` is the ink at the opacity that leaves that colour, the cheap way to
// lay it ('multiply' costs about twice as much per frame on a GPU canvas).

'use strict';

const { rng } = require('../../core/rand.js');
const { rgb, hex, toLinear, toSRGB } = require('../../core/colour.js');

const W = 1200;
const H = 800;
const PAPER = '#efe9dc';
const INK = '#16161b';

const paperLin = rgb(PAPER).slice(0, 3).map(toLinear);
const inkLin = rgb(INK).slice(0, 3).map(toLinear);
const memo = (f) => { const m = new Map(); return (c) => m.get(c) || (m.set(c, f(c)), m.get(c)); };

/** The colour ink at concentration c in [0, 1] leaves on the bare paper. */
const tone = memo((c) => hex(paperLin.map((p, i) => toSRGB(p * (inkLin[i] / p) ** c))));

/** The ink at the opacity that leaves tone(c) on bare paper; close to 'multiply' wherever marks do not pile up. */
const wash = memo((c) => {
  const [ir, ig, ib] = rgb(INK);
  const p = toSRGB(paperLin[1]);
  const a = (p - toSRGB(paperLin[1] * (inkLin[1] / paperLin[1]) ** c)) / (p - ig);
  return `rgba(${Math.round(ir * 255)}, ${Math.round(ig * 255)}, ${Math.round(ib * 255)}, ${a.toFixed(3)})`;
});

/** Build stage: the light, the paper's formation and its tooth, from the seed alone. */
function lay(s) {
  const R = rng(s.seed);
  // The light comes in from one side of the sheet and falls off across all of it.
  s.light = (R('light', 'angle') - 0.5) * Math.PI * 0.9 - Math.PI * 0.75;
  // Formation: a sheet is a little heavier in some places than others.
  s.clouds = Array.from({ length: 16 }, (_, i) => ({
    x: R('cloud', 'x', i) * W, y: R('cloud', 'y', i) * H,
    r: 120 + R('cloud', 'r', i) * 260, heavy: R('cloud', 'heavy', i) < 0.5,
  }));
  // The tooth: small bumps, most of them tiny, close enough to run together,
  // on a tile of TILE units that repeats across the sheet.
  s.tooth = Array.from({ length: 1400 }, (_, i) => [R('tooth', 'x', i) * TILE, R('tooth', 'y', i) * TILE, 0.35 + Math.pow(R('tooth', 'r', i), 2) * 1.1]);
}

/** The bare sheet: its colour, its light, its formation and its tooth. Reads no playhead. */
function ground(g, s) {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  // Light across the whole sheet, from the side it comes in.
  const dx = Math.cos(s.light) * W * 0.6;
  const dy = Math.sin(s.light) * H * 0.6;
  const lit = g.createLinearGradient(W / 2 + dx, H / 2 + dy, W / 2 - dx, H / 2 - dy);
  lit.addColorStop(0, 'rgba(255, 252, 244, 0.55)');
  lit.addColorStop(0.55, 'rgba(255, 252, 244, 0)');
  lit.addColorStop(1, 'rgba(96, 80, 58, 0.10)');
  g.fillStyle = lit;
  g.fillRect(0, 0, W, H);
  for (const c of s.clouds) {
    const r = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
    r.addColorStop(0, c.heavy ? 'rgba(120, 104, 80, 0.05)' : 'rgba(255, 253, 247, 0.16)');
    r.addColorStop(1, c.heavy ? 'rgba(120, 104, 80, 0)' : 'rgba(255, 253, 247, 0)');
    g.fillStyle = r;
    g.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
  }
  tooth(g, s);
}

const TILE = 320;

/**
 * The tooth, each bump shaded away from the light and lit towards it. On a
 * canvas it is drawn once on a tile at the surface's scale and laid as a
 * pattern; elsewhere the tile's bumps are drawn across the sheet.
 */
function tooth(g, s) {
  const m = typeof g.getTransform === 'function' ? g.getTransform() : null;
  const k = m ? Math.hypot(m.a, m.b) : 1;
  const px = Math.round(TILE * k);
  const make = typeof OffscreenCanvas === 'function' ? () => new OffscreenCanvas(px, px) : null;
  if (!make || typeof g.createPattern !== 'function' || !(px > 0)) {
    for (let x = 0; x < W; x += TILE) for (let y = 0; y < H; y += TILE) bumps(g, s, x, y, false);
    return;
  }
  const tile = make();
  const tg = tile.getContext('2d');
  tg.scale(px / TILE, px / TILE);
  bumps(tg, s, 0, 0, true);
  const pattern = g.createPattern(tile, 'repeat');
  // The tile holds TILE units at the surface's own pixels: undo the surface's scale for it.
  pattern.setTransform(new DOMMatrix([TILE / px, 0, 0, TILE / px, 0, 0]));
  g.fillStyle = pattern;
  g.fillRect(0, 0, W, H);
}

/** The tile's bumps at (ox, oy); with `wrap`, a bump that crosses an edge is drawn again across it. */
function bumps(g, s, ox, oy, wrap) {
  const lx = Math.cos(s.light), ly = Math.sin(s.light);
  const across = (v) => (wrap && v < 3 ? [0, TILE] : wrap && v > TILE - 3 ? [0, -TILE] : [0]);
  for (const [colour, side] of [['rgba(92, 76, 54, 0.075)', -0.6], ['rgba(255, 254, 250, 0.26)', 0.5]]) {
    g.fillStyle = colour;
    g.beginPath();
    for (const [x, y, r] of s.tooth) {
      for (const dx of across(x)) for (const dy of across(y)) {
        const cx = ox + dx + x + lx * r * side, cy = oy + dy + y + ly * r * side;
        g.moveTo(cx + r * 0.8, cy);
        g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      }
    }
    g.fill();
  }
}

module.exports = { W, H, PAPER, INK, tone, wash, lay, ground };
