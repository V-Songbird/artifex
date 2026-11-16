// Kandinsky: geometric abstraction on warm paper. Circles with soft halos,
// concentric rings, triangles, half discs, rainbows of arcs, heavy bars,
// chequer strips, small grids and thin crossing lines; overlaps multiply
// like glazes.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { path } = require('./kit.js');

// The palette: one black, warm and cool primaries and their neighbours, paper.
const COLOURS = {
  paper: '#efe8d8', black: '#1b1b1f', red: '#d8412f', vermilion: '#e0452b', yellow: '#f2c14e',
  ochre: '#d9a441', blue: '#2f5fa7', deep: '#23407a', teal: '#3fa9a2', pink: '#e98aa6',
  green: '#5a9e5a', violet: '#7b5ea7', orange: '#ec8a2f',
};
const LIGHT = '#fbf7ee';

// Warm paper over a `w` x `h` sheet with a slight brown vignette.
function paper(g, w, h) {
  g.fillStyle = COLOURS.paper;
  g.fillRect(0, 0, w, h);
  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.76);
  vig.addColorStop(0, 'rgba(120, 95, 60, 0)');
  vig.addColorStop(1, 'rgba(120, 95, 60, 0.16)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
}

// Shapes drawn inside `paint()` multiply with what is below, like glazes.
function glaze(g, paint) {
  g.save();
  g.globalCompositeOperation = 'multiply';
  paint();
  g.restore();
}

// A filled circle; `fill` may be a gradient.
function disc(g, x, y, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// A soft halo: a radial wash of the colour `rgb` ('r, g, b') at `alpha` from
// radius `r0`, fading to nothing at `r1`. Lay halos first, under everything.
function halo(g, x, y, r0, r1, rgb, alpha) {
  const h = g.createRadialGradient(x, y, r0, x, y, r1);
  h.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  h.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = h;
  g.beginPath();
  g.arc(x, y, r1, 0, Math.PI * 2);
  g.fill();
}

// A straight line from a to b, `width` wide: thin for crossing lines, 7 for a
// heavy one, 24 for a bar.
function line(g, a, b, width, colour = COLOURS.black, cap = 'butt') {
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = cap;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
}

// A stroked arc of radius `r` from `a0` to `a1`, or a whole ring by default:
// long sweeping arcs, rings round a dot, rings inside rings.
function arc(g, x, y, r, width, colour = COLOURS.black, a0 = 0, a1 = Math.PI * 2) {
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.beginPath();
  g.arc(x, y, r, a0, a1);
  g.stroke();
}

// A half disc of radius `r`, its straight edge starting at angle `from`.
function half(g, x, y, r, from, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, from, from + Math.PI);
  g.closePath();
  g.fill();
}

// A filled polygon, such as a triangle.
function shape(g, pts, fill) {
  g.fillStyle = fill;
  path(g, pts);
  g.fill();
}

// A rainbow: concentric arc bands `width` wide from radius `r`, one per colour.
function rainbow(g, x, y, r, width, a0, a1, colours) {
  g.lineCap = 'butt';
  colours.forEach((c, i) => {
    g.strokeStyle = c;
    g.lineWidth = width;
    g.beginPath();
    g.arc(x, y, r + i * width, a0, a1);
    g.stroke();
  });
}

// A chequer strip of `cols` x `rows` squares of `size`, from (x, y) along
// `angle`, black and light, outlined.
function chequer(g, x, y, angle, cols = 9, rows = 2, size = 14) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  for (let k = 0; k < cols; k++) {
    for (let j = 0; j < rows; j++) {
      g.fillStyle = (k + j) % 2 ? COLOURS.black : LIGHT;
      g.fillRect(k * size, j * size, size, size);
    }
  }
  g.strokeStyle = COLOURS.black;
  g.lineWidth = 2;
  g.strokeRect(0, 0, cols * size, rows * size);
  g.restore();
}

// A small grid of thin lines from (x0, y0) to (x1, y1), `count` lines each
// way `step` apart.
function grid(g, x0, y0, x1, y1, step, count = 5, width = 2) {
  g.strokeStyle = COLOURS.black;
  g.lineWidth = width;
  for (let k = 0; k < count; k++) {
    line(g, [x0 + k * step, y0], [x0 + k * step, y1], width);
    line(g, [x0, y0 + k * step], [x1, y0 + k * step], width);
  }
}

// A line from a to b with ticks `every` units along x from `from` to `to`,
// each `tick` long either side: a scale, a measured line.
function ruler(g, a, b, opts = {}) {
  const { from = a[0], to = b[0], every = 16, tick = 9, width = 3, tickWidth = 2 } = opts;
  line(g, a, b, width);
  for (let x = from; x <= to; x += every) {
    const y = a[1] - ((x - a[0]) / (b[0] - a[0])) * (a[1] - b[1]);
    line(g, [x, y - tick], [x, y + tick], tickWidth);
  }
}

// A crescent: the disc [x, y, r] with the disc `bite` [x, y, r] cut out of
// it, on a `w` x `h` sheet.
function crescent(g, w, h, [x, y, r], bite, fill) {
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.arc(bite[0], bite[1], bite[2], 0, Math.PI * 2);
  g.clip('evenodd');
  disc(g, x, y, r, fill);
  g.restore();
}

module.exports = { COLOURS, paper, glaze, disc, halo, line, arc, half, shape, rainbow, chequer, grid, ruler, crescent };
