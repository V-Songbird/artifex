// Backlit silhouettes: flat sheets in front of a lit screen, seen from the
// far side of the light, as on a light table or a shadow screen. A sheet of
// coloured gel or tissue lets the light through and tints it, two sheets
// darken where they overlap, and an opaque card stops the light and reads as
// black. Nothing casts a shadow and no sheet shows an edge of its own: a
// sheet is only what it does to the light.
//
// A parts bin: functions that draw the style's marks on any outline you give
// them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { bbox } = require('../../../core/geom.js');
const { sub, grain, soft } = require('./kit.js');

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb = (c, k, to = 0) => 'rgb(' + c.map((v) => Math.round(v * k + to * (1 - k))).join(', ') + ')';

// The lit screen, `w` by `h`, in the hex `light`: hottest in front of the
// `lamp` ([x, y], default the centre), falling to `fall` (0.45) of the light
// at `reach` (default the far corner) from it. Faint specks, `fibre` per
// million square units (3000), are the cloth or paper of the screen and keep
// the falloff from banding.
function screen(g, R, w, h, opts = {}) {
  const { light = '#f6d9a0', lamp = [w / 2, h / 2], fall = 0.45, fibre = 3000 } = opts;
  const [lx, ly] = lamp;
  const reach = opts.reach || Math.hypot(Math.max(lx, w - lx), Math.max(ly, h - ly));
  const c = hexRgb(light);
  const glow = g.createRadialGradient(lx, ly, 0, lx, ly, reach);
  glow.addColorStop(0, rgb(c, 0.4, 255));
  glow.addColorStop(0.45, rgb(c, 1));
  glow.addColorStop(1, rgb(c, fall));
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  grain(g, R, 'screen', w, h, Math.round((fibre * w * h) / 1e6), 'rgba(255, 255, 255, 0.05)', 'rgba(40, 25, 10, 0.05)');
}

// Fills `shape`, one outline or a list of them (even-odd, so an outline inside
// another is an opening), with the surface's current blending and alpha. A
// sheet held `lift` units off the screen loses its edge over about that
// distance, up to five pixels of the output, and keeps its tone.
function sheet(g, shape, fill, lift) {
  const rings = typeof shape[0][0] === 'number' ? [shape] : shape;
  const draw = (s) => {
    s.fillStyle = fill;
    s.beginPath();
    for (const ring of rings) sub(s, ring);
    s.fill('evenodd');
  };
  const k = typeof g.getTransform === 'function' ? Math.hypot(g.getTransform().a, g.getTransform().b) : 1;
  if (!(lift * k > 1.5)) { draw(g); return; }
  const [x0, y0, x1, y1] = bbox(rings.flat());
  soft(g, x0 - lift, y0 - lift, x1 - x0 + 2 * lift, y1 - y0 + 2 * lift, Math.max(0.2, 1 / (lift * k)), draw);
}

// A translucent sheet over `shape` in `colour` (a colour, or a canvas
// gradient for a sheet dyed unevenly): it multiplies what is behind it, so
// the screen's light shows through tinted, and each further sheet darkens the
// overlap. `density` (0.85) is how much of its colour one sheet holds; `lift`
// (0) holds it off the screen, which softens its edge.
function gel(g, shape, colour, opts = {}) {
  const { density = 0.85, lift = 0 } = opts;
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = density;
  sheet(g, shape, colour, lift);
  g.restore();
}

// An opaque card over `shape`: it stops the light, so it is `colour`
// ('#14100c', a warm near-black) whatever is behind it, and an opening cut in
// it shows the screen and the gels behind. `lift` as for `gel`.
function card(g, shape, opts = {}) {
  const { colour = '#14100c', lift = 0 } = opts;
  g.save();
  sheet(g, shape, colour, lift);
  g.restore();
}

module.exports = { screen, gel, card };
