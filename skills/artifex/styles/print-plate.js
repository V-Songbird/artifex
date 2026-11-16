// Print plates: a picture printed in separations, as a risograph, a screen
// print or a newspaper halftone is. Each ink has its own plate, drawn alone;
// the plates are then printed over the paper in a fixed order, each darkening
// what is under it, so every colour beyond the inks themselves is an overprint
// and every white is paper left bare. Each plate sits a little out of
// register, and tone is a screen of dots at the ink's own angle.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { sibling } = require('../../../core/layer.js');

// The angles, in degrees, that keep four screens from beating into a coarse
// pattern: 30 apart for the three strong inks, the palest at 0.
const ANGLES = [15, 75, 45, 0];

// A seeded register offset for ink `i` of a job: up to `reach` design units
// any way. A few film pixels reads as print; none reads as a screen image.
function register(R, name, i, reach) {
  const a = R(name, 'turn', i) * 2 * Math.PI;
  const d = reach * (0.4 + 0.6 * R(name, 'far', i));
  return [d * Math.cos(a), d * Math.sin(a)];
}

// A print job over the design box (0, 0, w, h) on `g`. `inks` are printed in
// the order given: `[{ name, colour, offset: [dx, dy], density }]`, the offset
// in design units (default none) and the density of a solid from 0 to 1
// (default 0.92: ink never quite hides the paper). Returns the job; draw each
// plate with `plate`, cut whites with `knockout`, then `print`.
function job(g, w, h, inks) {
  const names = inks.map((ink) => ink.name);
  if (new Set(names).size !== names.length || names.some((n) => typeof n !== 'string' || !n)) throw new Error('print-plate job: each ink takes its own name, got ' + JSON.stringify(names));
  const reach = Math.max(0, ...inks.map((ink) => Math.hypot(...(ink.offset || [0, 0]))));
  const c0 = g.canvas;
  const m = c0 && typeof g.getTransform === 'function' && typeof g.drawImage === 'function' ? g.getTransform() : null;
  // Each plate is a buffer padded by the furthest offset, so a shifted plate
  // still carries ink to the frame's edge.
  const pad = m ? Math.ceil(reach * Math.hypot(m.a, m.b)) + 2 : 0;
  const plates = inks.map((ink) => {
    const c = m ? sibling(c0, c0.width + 2 * pad, c0.height + 2 * pad) : null;
    if (!c) return { ink, draws: [] };
    const attrs = typeof g.getContextAttributes === 'function' ? g.getContextAttributes() : {};
    const s = c.getContext('2d', { colorSpace: attrs.colorSpace, willReadFrequently: attrs.willReadFrequently });
    s.setTransform(m.a, m.b, m.c, m.d, m.e + pad, m.f + pad);
    s.fillStyle = ink.colour;
    s.strokeStyle = ink.colour;
    return { ink, c, s };
  });
  return { g, w, h, m, pad, reach, plates, cuts: [] };
}

// Draws on the plate of ink `name`: `draw(p)` paints with the context's own
// fill and stroke, already the ink's colour. What it paints is where the ink
// prints; an alpha under 1 prints thinner. On a surface with no canvas, such
// as an SVG, the drawing is kept and printed straight on the surface.
function plate(J, name, draw) {
  const p = J.plates.find((one) => one.ink.name === name);
  if (!p) throw new Error('print-plate plate: no ink named ' + name + '; this job prints ' + J.plates.map((one) => one.ink.name).join(', '));
  if (!p.s) { p.draws.push(draw); return; }
  p.s.save();
  draw(p.s);
  p.s.restore();
}

// A white: `shape(p)` builds a path, and it is erased from every plate, grown
// by `grow` design units (default the furthest register offset plus a hair),
// so no shifted plate prints a sliver inside it. Paper shows there.
function knockout(J, shape, grow = J.reach * 1.25) {
  J.cuts.push({ shape, grow });
  for (const p of J.plates) {
    if (!p.s) continue;
    p.s.save();
    p.s.globalCompositeOperation = 'destination-out';
    p.s.globalAlpha = 1;
    p.s.fillStyle = '#000';
    p.s.strokeStyle = '#000';
    p.s.lineJoin = 'round';
    p.s.lineWidth = 2 * grow;
    shape(p.s);
    p.s.fill();
    if (grow > 0) p.s.stroke();
    p.s.restore();
  }
}

// A screen: tone as dots on a square lattice `pitch` design units apart,
// turned by `angle` degrees, over the box `[x, y, w, h]`. `tone(x, y)` is the
// share of ink from 0 to 1 at a point; a dot covers that share of its cell, so
// dots join past about 0.79 and the plate is solid at 1. `voids` (default
// 0.015) is the chance a dot fails to print, drawn from R under `name`: give
// each ink its own name, since voids shared by two plates punch white
// pinholes through both.
function screen(p, R, name, tone, box, { pitch, angle = 45, voids = 0.015 }) {
  if (!(pitch > 0)) throw new Error('print-plate screen: pitch takes a number above 0 in design units, got ' + pitch);
  const [x, y, w, h] = box;
  const a = (angle * Math.PI) / 180; const c = Math.cos(a); const s = Math.sin(a);
  const cx = x + w / 2; const cy = y + h / 2;
  const n = Math.ceil(Math.hypot(w, h) / 2 / pitch) + 1;
  // Dots are cut at the box, as a plate's edge cuts them.
  p.save();
  p.beginPath();
  p.rect(x, y, w, h);
  p.clip();
  p.beginPath();
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const px = cx + (i * c - j * s) * pitch; const py = cy + (i * s + j * c) * pitch;
      if (px < x - pitch || py < y - pitch || px > x + w + pitch || py > y + h + pitch) continue;
      const t = Math.min(1, Math.max(0, tone(px, py)));
      if (!(t > 0) || R(name, 'void', (j + n) * (2 * n + 1) + i + n) < voids) continue;
      // A dot of radius r covers pi r^2 of a cell of pitch^2; past touching it
      // grows on to the cell's corner, where the plate is solid.
      const r = pitch * (t < 0.785 ? Math.sqrt(t / Math.PI) : 0.5 + (t - 0.785) * 0.97);
      p.moveTo(px + r, py);
      p.arc(px, py, r, 0, 2 * Math.PI);
    }
  }
  p.fill();
  p.restore();
}

// Prints the job: `paper` (a colour, or null to keep what is on `g`) under
// the plates, each multiplied over the last in the job's ink order at its own
// offset and density. On a surface with no canvas the plates' drawings print
// straight on it, and each knockout is paper laid on top.
function print(J, paper = null) {
  const { g, w, h, m, pad } = J;
  g.save();
  if (paper) { g.fillStyle = paper; g.fillRect(0, 0, w, h); }
  for (const p of J.plates) {
    const [dx, dy] = p.ink.offset || [0, 0];
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = p.ink.density === undefined ? 0.92 : p.ink.density;
    if (p.c) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(p.c, m.a * dx + m.c * dy - pad, m.b * dx + m.d * dy - pad);
    } else {
      g.translate(dx, dy);
      g.fillStyle = p.ink.colour;
      g.strokeStyle = p.ink.colour;
      for (const draw of p.draws) { g.save(); draw(g); g.restore(); }
    }
    g.restore();
  }
  if (!m && paper) {
    for (const { shape } of J.cuts) { g.fillStyle = paper; shape(g); g.fill(); }
  }
  g.restore();
}

module.exports = { ANGLES, register, job, plate, knockout, screen, print };
