// Light painting: a long exposure at night. A hand-held light traces a path,
// its colour drifting as it moves; where it slowed or crossed itself the
// trail burns brighter, towards white. Spun steel wool throws arcs of sparks,
// a light swung on a string leaves an orb, and wet ground mirrors everything,
// dimmer and broken by ripples. All light adds: nothing covers.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { fbm } = require('../../../core/rand.js');
const { chaikin, resample } = require('../../../core/geom.js');
const { mix } = require('../../../core/colour.js');
const { wobble, shadow } = require('./kit.js');

// Lines of light as one path; `dx` moves them out of sight.
function stroke(g, lines, dx = 0) {
  g.beginPath();
  for (const line of lines) {
    g.moveTo(line[0][0] - dx, line[0][1]);
    for (let k = 1; k < line.length; k++) g.lineTo(line[k][0] - dx, line[k][1]);
  }
  g.stroke();
}

// The glow round lines of light of one colour: a wide faint one and a near
// brighter one, each the blurred shadow of a stroke drawn out of sight, OFF
// units to the left, so the light falls off smoothly with no edge. Light adds
// ('lighter'), and pieces of a line meet with butt caps, since round caps
// would overlap at every joint and add a brighter blotch there. A blur costs
// far more than a stroke, so each glow is one stroke of all its lines.
const OFF = 4000;
function glow(g, lines, width, colour, bright) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineJoin = 'round';
  g.lineCap = 'butt';
  g.strokeStyle = '#000000';
  // [stroke width, blur, alpha]
  for (const [w, blur, a] of [[width * 2.4, width * 4, 0.7], [width * 1.2, width * 1.2, 0.5]]) {
    g.lineWidth = w;
    shadow(g, colour, blur, OFF);
    g.globalAlpha = Math.min(1, a * bright);
    stroke(g, lines, OFF);
  }
  g.restore();
}

// The hot core of a line of light, nearly white, drawn in pieces of STEP
// points so its colour can follow `hue(t)`. It is the only visible stroke of
// a trail, so it stays crisp. It is already as bright as the light gets, so
// it takes the lighter of itself and what is there ('lighten') instead of
// adding: round caps then close every joint, even at a sharp turn, without a
// bead where two pieces overlap.
const STEP = 6;
function core(g, pts, width, hue, bright) {
  const n = pts.length;
  g.save();
  g.globalCompositeOperation = 'lighten';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = width * 0.5;
  g.globalAlpha = Math.min(1, 0.9 * bright);
  for (let i = 0; i < n - 1; i += STEP) {
    g.strokeStyle = mix(hue(i / (n - 1)), '#ffffff', 0.7);
    stroke(g, [pts.slice(i, i + STEP + 1)]);
  }
  g.restore();
}

// Where the light goes on a `w` x `h` picture: cores on the picture, glows on
// a canvas of their own at `scale` of its resolution, added over the picture
// once by `add()` after every light is drawn. All light adds, so the order
// does not matter, and a blur there costs the same at any output size. A
// surface with no canvas to make another from takes the glows directly.
function lights(g, w, h, scale = 0.5) {
  const cw = w * scale, ch = h * scale, doc = g.canvas && g.canvas.ownerDocument;
  const c = doc ? Object.assign(doc.createElement('canvas'), { width: cw, height: ch })
    : g.canvas && typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(cw, ch) : null;
  if (!c) return { core: g, glow: g, add() {} };
  const glows = c.getContext('2d', { alpha: false });
  glows.scale(scale, scale);
  const add = () => {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.imageSmoothingEnabled = true;
    g.drawImage(c, 0, 0, w, h);
    g.restore();
  };
  return { core: g, glow: glows, add };
}

// A trail of light along `pts` (from `lights`' L): its glow and its core,
// `width` wide, coloured by `hue(t)` along its length. The glow's colour
// changes every GLOW points, where its blur hides each step, and its
// brightness follows the hand's changing speed: slower stretches burn brighter.
const GLOW = 12;
function trail(L, pts, width, hue, bright = 1) {
  const n = pts.length;
  const pace = (i) => 0.92 + 0.28 * Math.sin(i * 0.031 + n) * Math.sin(i * 0.013 + 1.7);
  const runs = [];
  for (let i = 0; i < n - 1; i += GLOW) {
    const c = hue(Math.min(1, (i + GLOW / 2) / (n - 1)));
    const last = runs[runs.length - 1];
    if (last && last.c === c) last.len += GLOW;
    else runs.push({ i, len: GLOW, c });
  }
  for (const r of runs) glow(L.glow, [pts.slice(r.i, r.i + r.len + 1)], width, r.c, bright * pace(r.i + r.len / 2));
  core(L.core, pts, width, hue, bright);
}

// A hand's path through `pts`: resampled every 3 units and pushed by `amp` at
// a step of `step`. A closed loop is rounded once first; trace each closed
// part as its own loop, the light switched off between them.
function hand(R, name, pts, opts = {}) {
  const { close = true, amp = 2.2, step = 14 } = opts;
  return wobble(resample(close ? chaikin(pts, 1, true) : pts, 3, close), R, name, amp, step, close);
}

// A light held still: a radial burn of radius `r`, white at the middle,
// warm at a quarter, fading out.
function spot(g, x, y, r = 34) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const burn = g.createRadialGradient(x, y, 0, x, y, r);
  burn.addColorStop(0, 'rgba(255, 255, 255, 1)');
  burn.addColorStop(0.25, 'rgba(255, 220, 160, 0.8)');
  burn.addColorStop(1, 'rgba(255, 120, 60, 0)');
  g.fillStyle = burn;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

// A light swung in widening loops while walking: `n` points from (x, y)
// moving by (dx, dy), radius `r` growing by `grow`, `half` half-turns.
function spiral(x, y, opts = {}) {
  const { n = 240, dx = 70, dy = -230, r: r0 = 10, grow = 34, half = 7 } = opts;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n; const r = r0 + grow * t;
    pts.push([x + t * dx + r * Math.cos(t * Math.PI * half), y + t * dy - r * Math.sin(t * Math.PI * half)]);
  }
  return pts;
}

// Spun steel wool: `n` burning fibres flung from (cx, cy) up to about `r`
// along bending arcs that fall as they cool, a fifth white-hot. `mirror`, a
// function of y, draws their reflection; `dim` scales their brightness.
function sparks(g, R, name, cx, cy, r, n, dim = 1, mirror = null) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = R(name, 'a', i) * Math.PI * 2;
    const reach = r * (0.35 + 0.9 * R(name, 'r', i) ** 0.7);
    const bend = (R(name, 'b', i) - 0.5) * 0.9 + 0.35;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const d = reach * t; const ang = a + bend * t * t;
      const drop = 90 * t * t * R(name, 'g', i);
      const x = cx + Math.cos(ang) * d; let y = cy + Math.sin(ang) * d * 0.9 + drop;
      if (mirror) y = mirror(y);
      pts.push([x, y]);
    }
    const heat = R(name, 'h', i);
    for (let k = 1; k < pts.length; k++) {
      const t = k / (pts.length - 1);
      g.strokeStyle = heat > 0.8 ? '#fff2c0' : heat > 0.4 ? '#ffb347' : '#ff7a2a';
      g.globalAlpha = dim * (0.55 * (1 - t) + 0.08);
      g.lineWidth = 2.2 * (1 - t) + 0.6;
      g.beginPath();
      g.moveTo(pts[k - 1][0], pts[k - 1][1]);
      g.lineTo(pts[k][0], pts[k][1]);
      g.stroke();
    }
  }
  g.restore();
}

// A light swung round on a string: 16 rings of radius `r` at every tilt, one
// colour, so the whole orb glows in one piece. `mirror`, a function of y,
// draws its reflection, rippled by `ripple` at `name`.
function orb(L, R, name, cx, cy, r, hue, dim = 1, mirror = null) {
  const rings = [];
  for (let k = 0; k < 16; k++) {
    const tilt = (k / 16) * Math.PI;
    const pts = [];
    for (let i = 0; i <= 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const x = cx + Math.cos(a) * r * Math.cos(tilt);
      let y = cy + Math.sin(a) * r * 0.96 + Math.cos(a) * r * Math.sin(tilt) * 0.12;
      if (mirror) y = mirror(y);
      pts.push([x, y]);
    }
    rings.push(mirror ? ripple(R, name, pts) : pts);
  }
  glow(L.glow, rings, 1.6, hue, 0.5 * dim);
  for (const ring of rings) core(L.core, ring, 1.6, () => hue, 0.5 * dim);
}

// Reflection in wet ground: y flipped about the waterline `ground` and
// squashed toward it to `squash` of its height. Flat water keeps the height;
// the squash is a stylistic shortening that keeps a tall reflection in frame.
function mirrorY(ground, squash = 0.42) {
  return (y) => ground + (ground - y) * squash;
}

function reflect(pts, ground, squash = 0.42) {
  const m = mirrorY(ground, squash);
  return pts.map(([x, y]) => [x, m(y)]);
}

// Ripples: each point of a reflection pushed sideways by up to `amp` / 2.
function ripple(R, name, pts, amp = 14) {
  return pts.map(([x, y]) => [x + amp * (fbm(R, x / 90, y / 8, 2, name) - 0.5), y]);
}

// Paint on the picture and the glow canvas both clipped to a box [x, y, w, h],
// such as the wet ground under the waterline.
function within(L, box, paint) {
  for (const c of [L.core, L.glow]) {
    c.save();
    c.beginPath();
    c.rect(...box);
    c.clip();
  }
  paint();
  L.glow.restore();
  L.core.restore();
}

// Night: a sky graded to `horizon` on a `w` x `h` frame and a darker ground below.
function night(g, w, h, horizon) {
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#04050b');
  sky.addColorStop(0.75, '#0b0d1c');
  sky.addColorStop(1, '#1b1726');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, horizon);
  const ground = g.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, '#0c0b12');
  ground.addColorStop(1, '#040407');
  g.fillStyle = ground;
  g.fillRect(0, horizon, w, h - horizon);
}

// Faint stars: `n` specks over a `w` x `h` box.
function stars(g, R, name, w, h, n = 160) {
  for (let i = 0; i < n; i++) {
    const x = R(name, 'x', i) * w; const y = R(name, 'y', i) * h;
    g.fillStyle = 'rgba(210, 220, 255, ' + (0.15 + 0.5 * R(name, 'a', i) ** 3).toFixed(2) + ')';
    g.fillRect(x, y, 1.4, 1.4);
  }
}

// A near-black silhouette along the horizon, `rise` to `rise + tall` high,
// and a thin glow on the horizon itself.
function skyline(g, R, name, w, horizon, opts = {}) {
  const { rise = 40, tall = 60, step = 20, scale = 120, colour = '#07070d' } = opts;
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(0, horizon);
  for (let x = 0; x <= w; x += step) g.lineTo(x, horizon - rise - tall * fbm(R, x / scale, 0, 3, name));
  g.lineTo(w, horizon);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(160, 150, 190, 0.05)';
  g.fillRect(0, horizon - 2, w, 4);
}

// Ground drying toward the camera: a `w`-wide fade from clear at `y0` to the
// ground's colour at `y1`, filled to the frame's bottom `h`, so no
// reflection is cut by the frame.
function fade(g, w, y0, y1, h, rgb = '4, 4, 7') {
  const dry = g.createLinearGradient(0, y0, 0, y1);
  dry.addColorStop(0, 'rgba(' + rgb + ', 0)');
  dry.addColorStop(1, 'rgba(' + rgb + ', 1)');
  g.fillStyle = dry;
  g.fillRect(0, y0, w, h - y0);
}

module.exports = { glow, core, lights, trail, hand, spot, spiral, sparks, orb, mirrorY, reflect, ripple, within, night, stars, skyline, fade };
