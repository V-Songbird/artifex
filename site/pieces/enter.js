// The portal's picture, for the portal seam and the shots that begin where it
// ends: a page torn out of a school notebook, the catalog's bird doodled on it
// in blue ballpoint (see page.js), slid in under one of the three bowed
// mirrors, the kaleidoscope carrying it into every reflection, and the camera
// going into one mirror, past its glass, to that mirror's reflection of the
// page, until the doodle fills the frame.
//
// WHAT STAYS IS KEPT. As in the bend (see bend.cjs), the lifted scene is kept
// and read once for the reflections' colours; while the page moves it is
// drawn into those colours over the region between the mirrors. The page
// itself is lines: drawn straight on the sheet, and, as the camera closes
// in, through the mirror's inversion, so the reflection it goes into is sharp.

'use strict';

const { keep, soft } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');
const Wt = require('./water.js');
const B = require('./brush.js');
const D = require('./dry.js');
const K = require('./kaleido.js');
const I = require('./inversion.js');
const Pg = require('./page.js');

// The bend's clocks at its last frame, which this seam continues.
const BEND = 179 / 30;                   // that frame's second
const MIRRORS = 209 / 30 + BEND;         // the mirrors' own clock there, for their glints
const TURNED = 0.03 * (BEND - 2.5) ** 2; // how far they had turned
const TURNING = 0.06 * (BEND - 2.5);     // and how fast, in radians a second
const BOWED = 0.4;
const ABSORB = 0.1;

const SETTLE = 1.2;          // seconds for the turn to die away, as a time constant
const SLIDE = [0.3, 2.5];    // the page slides in between these seconds
const FROM = 650;            // from this far away, under the next mirror round
const ZOOM = [2.7, 7];       // the camera goes in between these seconds
const DEEP = 12;             // this far

const turnAt = (sec) => TURNED + TURNING * SETTLE * (1 - Math.exp(-sec / SETTLE));
const smooth = (x) => { const u = Math.max(0, Math.min(1, x)); return u * u * u * (u * (u * 6 - 15) + 10); };
const centreOf = (t) => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];

/**
 * Build stage: which mirror the camera goes into (the one whose reflection of
 * the triangle's centre lies furthest inside the frame once the turn has died
 * away), and how the page lies at rest: turned so that, seen in that mirror,
 * it is upright.
 */
function aim(s) {
  const cs = I.circles(s, BOWED, turnAt(Infinity));
  const g = centreOf(s.triangle);
  let best = -Infinity;
  cs.forEach((c, i) => {
    const [x, y] = I.invert(c, g);
    const room = Math.min(x, P.W - x, y, P.H - y);
    if (room > best) { best = room; s.portal = i; }
  });
  // A mirror maps a direction at angle a to 2φ - a, φ its tangent's angle there.
  const [cx, cy] = cs[s.portal];
  const phi = Math.atan2(g[1] - cy, g[0] - cx) + Math.PI / 2;
  s.rest = 2 * phi - Math.PI;
  // The page slides in from under the next mirror round.
  const n = cs[(s.portal + 1) % 3];
  const l = Math.hypot(n[0] - g[0], n[1] - g[1]);
  s.from = [((n[0] - g[0]) / l) * FROM, ((n[1] - g[1]) / l) * FROM];
}

/** The page's map at second `sec`: page units to the sheet. */
function placed(s, sec) {
  const e = smooth((sec - SLIDE[0]) / (SLIDE[1] - SLIDE[0]));
  const g = centreOf(s.triangle);
  const rot = s.rest + 0.35 * (1 - e), c = Math.cos(rot), sn = Math.sin(rot);
  const x = g[0] + s.from[0] * (1 - e), y = g[1] + s.from[1] * (1 - e);
  // Mirrored, so that its reflection reads as the page itself.
  const map = (p) => [x - p[0] * c - p[1] * sn, y - p[0] * sn + p[1] * c];
  map.key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + rot.toFixed(4);
  return map;
}

// The reflections' colours with the page drawn in, per solve.
const lives = new WeakMap();

/**
 * The scene's colours, `tex`, with the page drawn in where it lies now over
 * the region between the mirrors; the mean tone the deepest reflections take
 * moves by as much as the page moves that region's.
 */
function withPage(s, tex, map) {
  let live = lives.get(s);
  if (!live) {
    const g = centreOf(s.triangle), reach = s.params.side / Math.sqrt(3) + 12;
    const x0 = Math.max(0, Math.floor((g[0] - reach) / 2)), y0 = Math.max(0, Math.floor((g[1] - reach) / 2));
    const w = Math.min(tex.w, Math.ceil((g[0] + reach) / 2)) - x0, h = Math.min(tex.h, Math.ceil((g[1] + reach) / 2)) - y0;
    const canvas = new OffscreenCanvas(w, h);
    const base = new ImageData(w, h), words = new Uint32Array(base.data.buffer);
    for (let y = 0; y < h; y++) words.set(tex.data.subarray((y0 + y) * tex.w + x0, (y0 + y) * tex.w + x0 + w), y * w);
    live = { tex: { ...tex, data: tex.data.slice() }, x0, y0, w, h, g: canvas.getContext('2d', { willReadFrequently: true }), base, from: meanOf(words), key: '' };
    lives.set(s, live);
  }
  if (live.key !== map.key) {
    const { g, x0, y0, w, h } = live;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.putImageData(live.base, 0, 0);
    g.setTransform(0.5, 0, 0, 0.5, -x0, -y0);
    Pg.drawPage(g, s, map, 1);
    const words = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
    for (let y = 0; y < h; y++) live.tex.data.set(words.subarray(y * w, y * w + w), (y0 + y) * live.tex.w + x0);
    const now = meanOf(words);
    live.tex.mean = tex.mean.map((v, i) => v + now[i] - live.from[i]);
    live.key = map.key;
  }
  return live.tex;
}

/** The mean red, green and blue of RGBA words, from every fifth. */
function meanOf(words) {
  let r = 0, gr = 0, b = 0, n = 0;
  for (let i = 0; i < words.length; i += 5, n++) { const c = words[i]; r += c & 255; gr += (c >>> 8) & 255; b += (c >>> 16) & 255; }
  return [r / n, gr / n, b / n];
}

/** The lifted scene, kept, with the page at rest on it. */
function paged(g, s, lifted) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(lifted, 0, 0);
  g.restore();
  Pg.drawPage(g, s, placed(s, SLIDE[1]));
}

/**
 * The page seen in the `portal` mirror, sharp: drawn through its inversion,
 * cut to the portal's disc, or uncut when the view lies inside the
 * reflection it goes into (`whole`).
 */
function reflection(g, s, portal, map, view, whole = false) {
  const [bx, by] = map([0, 0]), d2 = (bx - portal[0]) ** 2 + (by - portal[1]) ** 2;
  g.save();
  if (!whole) {
    g.beginPath();
    g.arc(portal[0], portal[1], portal[2], 0, 2 * Math.PI);
    g.clip();
  }
  Pg.drawPage(g, s, (p) => I.invert(portal, map(p)), (portal[2] * portal[2]) / d2, 6, view, (pg, a, b) => I.arcOf(pg, portal, map(a), map(b)));
  g.restore();
}

/** Whether polygon `poly` holds the whole rectangle `r` [x0, y0, x1, y1], tried at points along its edges. */
function covers(poly, r) {
  for (let k = 0; k <= 8; k++) {
    const u = k / 8, x = r[0] + (r[2] - r[0]) * u, y = r[1] + (r[3] - r[1]) * u;
    for (const p of [[x, r[1]], [x, r[3]], [r[0], y], [r[2], y]]) if (!within(poly, p)) return false;
  }
  return true;
}

/** Whether point `p` lies in polygon `poly` (even-odd). */
function within(poly, [x, y]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The lifted scene drawn directly, for the reflections' colours. */
function lifted(g, s) {
  const sheet = keep(g, s, 'torn', K.torn);
  if (sheet) K.pieces(g, s, K.LIFT, sheet, true);
}

function frame(g, s, sec) {
  const cs = I.circles(s, BOWED, turnAt(sec));
  const sheet = keep(g, s, 'torn', K.torn, (pg, ps) => { frame(pg, ps, 1.5); frame(pg, ps, 4.5); });
  const tex = sheet && I.texture(s, lifted);
  const map = placed(s, sec);
  if (!tex) {
    // A surface that keeps no copies: the torn sheet as it lies, the page on it, and the rims.
    D.dried(g, s);
    D.drawTears(g, s, Infinity, s.tearOrder);
    Pg.drawPage(g, s, map);
    I.drawRims(g, s, cs, MIRRORS + sec, BOWED, soft);
    return;
  }
  // Once the page is at rest it is part of the scene: kept with it.
  const bare = K.scene(g, s, sheet), rest = sec >= SLIDE[1];
  const scene = rest ? keep(g, s, 'paged', (cg, cs2) => paged(cg, cs2, bare)) : bare;
  const live = withPage(s, tex, map);
  // The camera: in towards the portal mirror's reflection of the page's bird,
  // which comes to the middle of the frame as the camera closes in.
  const e = 0.92 * smooth((sec - ZOOM[0]) / (ZOOM[1] - ZOOM[0])) + 0.08 * Math.max(0, Math.min(1, (sec - ZOOM[0]) / (ZOOM[1] - ZOOM[0])));
  const z = DEEP ** e, portal = cs[s.portal];
  const target = I.invert(portal, map([0, 0]));
  const fx = P.W / 2, fy = P.H / 2;
  const sx = target[0] + (fx - target[0]) * e, sy = target[1] + (fy - target[1]) * e;
  const tx = sx - target[0] * z, ty = sy - target[1] * z, m = g.getTransform();
  // The kept scene is the design box at the surface's scale: moved and scaled by the camera, pixel for pixel when it is still.
  g.save();
  g.setTransform(z, 0, 0, z, m.e + m.a * tx, m.f + m.d * ty);
  g.drawImage(scene, 0, 0);
  g.restore();
  // What the camera sees, in the sheet's units, with a margin for line widths.
  const view = [-tx / z - 4, -ty / z - 4, (P.W - tx) / z + 4, (P.H - ty) / z + 4];
  // The reflection the camera goes into: the region between the mirrors, in the portal.
  const cell = I.domain(cs).map((p) => I.invert(portal, p));
  const sharp = smooth((z - 1.3) / 0.5);
  if (sharp >= 1 && covers(cell, view)) {
    // All the camera sees is that reflection: nothing under it needs drawing.
    g.save();
    g.transform(z, 0, 0, z, tx, ty);
    reflection(g, s, portal, map, view, true);
    I.drawRims(g, s, cs, MIRRORS + sec, BOWED, soft, view);
    g.restore();
    return;
  }
  g.save();
  g.transform(z, 0, 0, z, tx, ty);
  // The page on the sheet, while the region between the mirrors is in view.
  const [gx, gy] = centreOf(s.triangle), reach = s.params.side / Math.sqrt(3);
  if (!rest && gx + reach > view[0] && gx - reach < view[2] && gy + reach > view[1] && gy - reach < view[3]) Pg.drawPage(g, s, map, 1, 0, view);
  if (sharp > 0) {
    // The reflection the camera goes into, sharp, cut only to the portal's
    // disc; the folded reflections then lie over whatever of it falls in
    // the others, and over its own place less and less as it comes into focus.
    reflection(g, s, portal, map, view);
    I.reflect(g, cs, ABSORB, live, z > 3, s.portal, 1 - sharp);
  } else {
    I.reflect(g, cs, ABSORB, live, z > 3);
  }
  I.drawRims(g, s, cs, MIRRORS + sec, BOWED, soft, view);
  g.restore();
}

/**
 * The camera of frame() at second `sec`, once it has gone in (from
 * ZOOM[0]): the mirrors `cs`, the `portal` one, the page's `map` onto the
 * sheet, the zoom `z` and offset `tx`, `ty` from the sheet to the frame,
 * what it sees (`view`, in the sheet's units) and whether that is all the
 * portal's reflection (`whole`), as frame() works them out.
 */
function camera(s, sec) {
  const cs = I.circles(s, BOWED, turnAt(sec));
  const map = placed(s, sec);
  const e = 0.92 * smooth((sec - ZOOM[0]) / (ZOOM[1] - ZOOM[0])) + 0.08 * Math.max(0, Math.min(1, (sec - ZOOM[0]) / (ZOOM[1] - ZOOM[0])));
  const z = DEEP ** e, portal = cs[s.portal];
  const target = I.invert(portal, map([0, 0]));
  const sx = target[0] + (P.W / 2 - target[0]) * e, sy = target[1] + (P.H / 2 - target[1]) * e;
  const tx = sx - target[0] * z, ty = sy - target[1] * z;
  const view = [-tx / z - 4, -ty / z - 4, (P.W - tx) / z + 4, (P.H - ty) / z + 4];
  const whole = smooth((z - 1.3) / 0.5) >= 1 && covers(I.domain(cs).map((p) => I.invert(portal, p)), view);
  return { cs, portal, map, z, tx, ty, view, whole };
}

/**
 * The portal's last view with the portal mirror let go by `w` (0 to 1, a
 * little past 1 as it springs): its bow relaxes, so the page it reflects
 * straightens from its inversion to `flat` (a similarity of the page into
 * the sheet's units), and its rim swings out of the frame. At 0 it draws what
 * frame() draws at END where the view is all the reflection: the page through
 * the inversion and the rims. Line widths go from the inversion's scale at
 * the bird to `flat`'s own, `k`.
 */
function released(g, s, w, flat, k) {
  const { cs, portal, map, z, tx, ty, view } = camera(s, END);
  g.save();
  g.transform(z, 0, 0, z, tx, ty);
  if (w === 0) {
    reflection(g, s, portal, map, view, true);
  } else {
    const [bx, by] = map([0, 0]), r2 = (portal[2] * portal[2]) / ((bx - portal[0]) ** 2 + (by - portal[1]) ** 2);
    const warp = (p) => { const a = I.invert(portal, map(p)), b = flat(p); return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]; };
    Pg.drawPage(g, s, warp, r2 + (k - r2) * w, 6, view);
  }
  // The rim swings out the way it faces: from the portal's centre past the view's.
  const vx = (view[0] + view[2]) / 2 - portal[0], vy = (view[1] + view[3]) / 2 - portal[1], l = Math.hypot(vx, vy);
  g.translate((vx / l) * 70 * w, (vy / l) * 70 * w);
  I.drawRims(g, s, cs, MIRRORS + END, BOWED, soft, view);
  g.restore();
}

// The portal's last frame, at 30 frames a second: where the shots after it begin.
const END = 209 / 30;

// The mirror shot's own knobs, so the mirrors are the ones that bowed.
const PARAMS = {
  strokes: { min: 12, max: 44, value: 30, meaning: 'how many strokes the brush laid' },
  reach: { min: 160, max: 620, value: 380, meaning: 'how far a stroke travelled along the current, in design units' },
  load: { min: 0.5, max: 1.3, value: 1, meaning: 'how dark the ink was: under 1 the brush was let down with water' },
  side: { min: 220, max: 460, value: 330, meaning: 'the length of each mirror: the side of the triangle the wallpaper repeats' },
};

const BUILD = [
  ['lay the paper', P.lay],
  ['plot the wordmark', M.plot],
  ['wet the sheet', Wt.soak],
  ['paint', B.paint],
  ['tear', D.tear],
  ['stand the mirrors', K.place],
  ['doodle the page', Pg.page],
  ['aim the camera', aim],
];

module.exports = { frame, camera, released, END, PARAMS, BUILD };
