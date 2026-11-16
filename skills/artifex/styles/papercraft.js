// Papercraft: layered paper collage. Torn sheets show the paper's white core
// along the tear and cast soft shadows on the sheet beneath; cut shapes have
// clean edges, because scissors made them. Colour is flat inside a sheet, with
// faint mottle, fibres, folds and printed matter for texture.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { noise2 } = require('../../../core/rand.js');
const { path, shadow } = require('./kit.js');

// The white core a torn edge shows, and the default shadows.
const CORE = '#eee8dc';
const TEAR_SHADOW = ['rgba(2, 3, 16, 0.8)', 22, 0, 10];
const CUT_SHADOW = ['rgba(3, 5, 25, 0.55)', 16, 8, 11];

// A torn edge along y from x0 to x1: n + 1 points pushed by a slow wave (amp x 4),
// a fast jag (amp) and hashed jitter (amp / 2). `wave` and `jag` are noise periods.
// Tear at another angle by drawing under g.rotate.
function tornEdge(R, name, x0, x1, y, amp, { n = 140, wave = 240, jag = 14 } = {}) {
  const edge = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * (i / n);
    const w = (noise2(R, x / wave, 0.5, name + 'wave') - 0.5) * amp * 4;
    const j = (noise2(R, x / jag, 3.5, name + 'jag') - 0.5) * amp + (R(name, 'j', i) - 0.5) * amp * 0.5;
    edge.push([x, y + w + j]);
  }
  return edge;
}

// A sheet torn along `edge`, its torn side facing +y. `back` is the untorn rest
// of its outline, from beyond the edge's first point round to beyond its last.
// Draws the white core lowered by rim[0] + noise x rim[1] under a soft shadow,
// then the coloured sheet; `mottle: [x, y, w, h]` mottles it inside its outline.
function tornSheet(g, R, name, edge, back, fill, { core = CORE, rim = [3, 9], shade = TEAR_SHADOW, mottle: box = null, ...look } = {}) {
  const outline = (lift) => {
    g.beginPath();
    g.moveTo(back[0][0], back[0][1]);
    for (let i = 1; i < back.length; i++) g.lineTo(back[i][0], back[i][1]);
    for (let i = edge.length - 1; i >= 0; i--) g.lineTo(edge[i][0], edge[i][1] + lift(i));
    g.closePath();
  };
  g.save();
  shadow(g, ...shade);
  g.fillStyle = core;
  outline((i) => rim[0] + noise2(R, i * 0.35, 9.1, name + 'rim') * rim[1]);
  g.fill();
  g.restore();
  g.fillStyle = fill;
  outline(() => 0);
  g.fill();
  if (!box) return;
  g.save();
  outline(() => 0);
  g.clip();
  mottle(g, R, name, box[0], box[1], box[2], box[3], look);
  g.restore();
}

// Mottle in the box (x, y, w, h): n soft discs of radius r[0] to r[0] + r[1],
// half faintly light, half faintly dark, so a flat fill reads as one sheet of
// paper. Each disc fades from its colour at the centre to nothing at its rim, so
// no edge shows. `light` and `dark` are rgba() strings. Clip to the sheet first.
// Keep both alphas at or under 0.03.
function mottle(g, R, name, x, y, w, h, { n = 40, r = [30, 60], light = 'rgba(255,255,255,0.016)', dark = 'rgba(0,0,20,0.03)' } = {}) {
  for (let i = 0; i < n; i++) {
    const colour = R(name, 'mt', i) < 0.5 ? light : dark;
    const cx = x + R(name, 'mx', i) * w; const cy = y + R(name, 'my', i) * h;
    const rad = r[0] + R(name, 'mr', i) * r[1];
    const fade = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    fade.addColorStop(0, colour);
    fade.addColorStop(1, colour.replace(/[\d.]+\)\s*$/, '0)'));
    g.fillStyle = fade;
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.fill();
  }
}

// A cut shape: the outline `pts` filled flat under its own soft shadow
// [colour, blur, dx, dy]. Cut overlapping parts back to front so each shadows the next.
function cutSheet(g, pts, fill, { shade = CUT_SHADOW } = {}) {
  g.save();
  shadow(g, ...shade);
  g.fillStyle = fill;
  path(g, pts);
  g.fill();
  g.restore();
}

// Paper fibres: n short curved hairs in the box (x, y, w, h), 22 units long.
// Clip to the sheet first; alpha about 0.1 on light paper.
function fibres(g, R, name, x, y, w, h, { n = 60, colour = 'rgba(150,130,100,0.10)' } = {}) {
  g.strokeStyle = colour;
  g.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const fx = x + R(name, 'x', i) * w; const fy = y + R(name, 'y', i) * h;
    const a = R(name, 'a', i) * Math.PI;
    g.beginPath();
    g.moveTo(fx, fy);
    g.quadraticCurveTo(fx + Math.cos(a) * 10, fy + Math.sin(a) * 10 + 4, fx + Math.cos(a) * 22, fy + Math.sin(a) * 22);
    g.stroke();
  }
}

// A fold: a thin line a shade darker than the sheet along the polyline `pts`.
function fold(g, pts, { colour = 'rgba(140,50,35,0.35)', width = 2 } = {}) {
  g.strokeStyle = colour;
  g.lineWidth = width;
  path(g, pts, false);
  g.stroke();
}

// Printed handwriting: rows of cursive loops `pitch` apart across the box
// (x0, y0)-(x1, y1), with random word gaps. Clip to the sheet first.
function script(g, R, name, x0, y0, x1, y1, colour, { width = 1.4, pitch = 17 } = {}) {
  g.strokeStyle = colour;
  g.lineWidth = width;
  for (let y = y0 + 14, row = 0; y < y1; y += pitch, row++) {
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

// Newsprint: `rows` lines of word bars from (x0, y0) to x1, `pitch` apart,
// `bar` high, each word word[0] to word[0] + word[1] long. Clip to the sheet first.
function newsprint(g, R, name, x0, y0, x1, rows, { colour = 'rgba(80,70,60,0.35)', pitch = 9.5, bar = 2.2, word = [8, 22], gap = 5 } = {}) {
  g.fillStyle = colour;
  for (let row = 0; row < rows; row++) {
    for (let x = x0; x < x1;) {
      const w = word[0] + R(name, 'w', row * 40 + Math.floor(x)) * word[1];
      g.fillRect(x, y0 + row * pitch, w, bar);
      x += w + gap;
    }
  }
}

module.exports = { CORE, TEAR_SHADOW, CUT_SHADOW, tornEdge, tornSheet, mottle, cutSheet, fibres, fold, script, newsprint };
