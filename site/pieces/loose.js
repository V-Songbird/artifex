// The Kandinsky's forms as loose skins of paint. The shots after the wall
// take the knife's forms off the painting: each solid form (every one but the
// three thin halos, which soaked into the ground) is a skin of dry paint that
// cracks free round its edge, lifts off the ground and lies loose on it, and
// can then be moved over the painting, lifted and turned, with its shadow.
//
// A SKIN IS THE FORM ITSELF. An opaque form is drawn alone onto its own small
// canvas, so laid back where it was it gives the painting's own pixels; a
// glaze, which the style multiplies over what lies beneath it, carries that
// ground away with it, as a skin of glaze would. Under the skins lies the
// painting with no forms on it, and where each form lay a faint stain of it.
//
// WHAT STAYS IS KEPT. The bare painting, its stains and every skin and its
// shadow are kept per solve and device scale in the painting's own pixels (see
// hang.js painting), so a frame lays copies.

'use strict';

const { pointInPoly, closestPointOnSegment } = require('../../core/geom.js');
const { sized: keep, has } = require('./held.js');
const Dr = require('./draft.js');
const Im = require('./impasto.js');
const Sc = require('./scrape.js');
const Hg = require('./hang.js');

const STAIN = 0.06;      // how much of a form's colour the ground keeps where it lay
const SOFT = 4;          // a shadow is kept at a quarter of the skin's resolution
const BLUR = 3;          // and blurred this many of its pixels
const EDGE = 'rgb(58, 42, 28)';   // a skin's cut edge, in shade

/**
 * The bounds, in sheet units, of what `draw(g)` paints, the paths it fills
 * and strokes, and whether it multiplies: `draw` is run against a surface
 * that only follows the transform and the path, so the build knows every
 * form's extent and shape without a canvas.
 */
function boundsOf(draw) {
  let m = [1, 0, 0, 1, 0, 0], lw = 1, pts = [], glaze = false;
  const stack = [], box = [Infinity, Infinity, -Infinity, -Infinity], paths = [];
  const add = (x, y) => pts.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const paint = (pad) => {
    const k = pad * Math.hypot(m[0], m[1]);
    paths.push({ pts: pts.slice(), half: k });
    for (const [x, y] of pts) { box[0] = Math.min(box[0], x - k); box[1] = Math.min(box[1], y - k); box[2] = Math.max(box[2], x + k); box[3] = Math.max(box[3], y + k); }
  };
  const gradient = () => ({ addColorStop() {} });
  const g = {
    save() { stack.push([m, lw]); },
    restore() { [m, lw] = stack.pop(); },
    translate(x, y) { m = [m[0], m[1], m[2], m[3], m[4] + m[0] * x + m[2] * y, m[5] + m[1] * x + m[3] * y]; },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[2] * c - m[0] * s, m[3] * c - m[1] * s, m[4], m[5]]; },
    scale(x, y) { m = [m[0] * x, m[1] * x, m[2] * y, m[3] * y, m[4], m[5]]; },
    beginPath() { pts = []; },
    moveTo: add,
    lineTo: add,
    closePath() {},
    rect(x, y, w, h) { add(x, y); add(x + w, y); add(x + w, y + h); add(x, y + h); },
    arc(cx, cy, r, a0, a1, ccw = false) {
      // The sweep a canvas draws: clockwise from a0 round to a1, or anticlockwise, and a whole turn at most.
      const T = 2 * Math.PI, d = ccw ? a0 - a1 : a1 - a0, sweep = (d >= T ? T : d >= 0 ? d : (d % T) + T) * (ccw ? -1 : 1);
      const n = Math.max(2, Math.ceil(Math.abs(sweep) / 0.1));
      for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; add(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    },
    fill() { paint(0); },
    stroke() { paint(lw / 2); },
    fillRect(x, y, w, h) { g.beginPath(); g.rect(x, y, w, h); g.fill(); },
    strokeRect(x, y, w, h) { g.beginPath(); g.rect(x, y, w, h); g.stroke(); },
    clip() { pts = []; },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    set lineWidth(v) { lw = v; },
    get lineWidth() { return lw; },
    set globalCompositeOperation(v) { if (v === 'multiply') glaze = true; },
    get globalCompositeOperation() { return 'source-over'; },
  };
  draw(g);
  return { box, glaze, paths };
}

/** Whether point `p` lies on skin `k`'s paint: inside a path it fills, or on a line it strokes. */
function covers(k, p) {
  return k.paths.some(({ pts, half }) => {
    if (!half) return pts.length > 2 && pointInPoly(p, pts);
    for (let i = 1; i < pts.length; i++) if (closestPointOnSegment(p, pts[i - 1], pts[i]).distance <= half) return true;
    return false;
  });
}

/** Build stage: every solid form as a skin, with its bounds, its middle and its size, in the style's order. */
function skins(s) {
  s.skins = [];
  for (const f of s.shapes) {
    if (s.steps[f.at].wash) continue;
    const { box, glaze, paths } = boundsOf(f.draw);
    const c = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], size = Math.hypot(box[2] - box[0], box[3] - box[1]);
    // Its kind of shape, for how it sounds: round (a disc, a ring, a half disc), a line (a stroke or an arc), or flat.
    const shape = paths.length === 1 && paths[0].pts.length >= 33 && !(paths[0].half && paths[0].pts.length < 60) ? 'round' : paths.every((p) => p.half) ? 'line' : 'flat';
    s.skins.push({ i: s.skins.length, f, z: f.z, glaze, box, c, size, paths, shape });
  }
  // Which skins lie over which: a skin comes free only once every one over it has.
  for (const k of s.skins) {
    k.over = s.skins.filter((o) => o.z > k.z && o.box[0] < k.box[2] && o.box[2] > k.box[0] && o.box[1] < k.box[3] && o.box[3] > k.box[1]).map((o) => o.i);
    // The skin it lies on, if any: the highest under its middle.
    const under = s.skins.filter((o) => o.z < k.z && covers(o, k.c));
    k.base = under.length ? under.reduce((a, b) => (b.z > a.z ? b : a)).i : -1;
  }
}

/** The painting's pixel grid on this canvas, as hang.js painting keeps it: { m, w, h, key }, or null on a surface with no canvas. */
function grid(g) {
  if (!g.canvas || typeof g.getTransform !== 'function') return null;
  const k = Dr.shot(Im.CLOSE), m = g.getTransform().multiply({ a: k.a, b: k.b, c: -k.b, d: k.a, e: k.x, f: k.y });
  const [x0, y0, x1, y1] = Hg.SHEET, p0 = m.transformPoint({ x: x0, y: y0 }), p1 = m.transformPoint({ x: x1, y: y1 });
  const px = 4 * Math.ceil(-p0.x / 4), py = 4 * Math.ceil(-p0.y / 4);
  m.e += px;
  m.f += py;
  return { m, w: Math.ceil(p1.x) + px, h: Math.ceil(p1.y) + py, key: [m.a, m.e, m.f].map((n) => n.toFixed(3)).join(' ') };
}

/** Paint `paint(cg, cs)` in sheet units onto a canvas of the painting's grid, clipped to the sheet. */
const onSheet = (m, paint) => (cg, cs) => {
  cg.setTransform(m);
  cg.beginPath();
  const [x0, y0, x1, y1] = Hg.SHEET;
  cg.rect(x0, y0, x1 - x0, y1 - y0);
  cg.clip();
  paint(cg, cs);
};

/** A skin's pixel rectangle on the painting's grid [x, y, w, h]. */
function rectOf(k, m) {
  const x0 = Math.floor(k.box[0] * m.a + m.e) - 3, y0 = Math.floor(k.box[1] * m.d + m.f) - 3;
  return [x0, y0, Math.ceil(k.box[2] * m.a + m.e) + 3 - x0, Math.ceil(k.box[3] * m.d + m.f) + 3 - y0];
}

// Solves that keep the copies, by seed and parameters. Every piece of the
// score draws the same forms from the same build, so a piece reached after
// another lays the copies the other made, under the first solve seen, instead
// of making its own. The last few seeds are kept.
const owners = new Map();
const OWNERS = 3;

/** The solve to keep solve `s`'s copies under: the first seen of its seed and parameters. */
function owner(s) {
  const key = s.seed + ' ' + JSON.stringify(s.params || {}), o = owners.get(key) || s;
  owners.delete(key);
  owners.set(key, o);
  if (owners.size > OWNERS) owners.delete(owners.keys().next().value);
  return o;
}

/**
 * Every kept picture of the loose skins on this canvas: { bare, sprites,
 * shades, m }, where `bare` is the painting with no forms and a stain where
 * each lay, each sprite a skin on the painting's grid and each shade its
 * soft shadow; null on a surface that keeps none. With `ahead` ({ grid,
 * ground, more(), made(canvas) }, see prepare) it makes copies not yet kept
 * only while more() says so, hands each to made, and returns false once one is
 * left unmade: the same copies in the same order, a few at a time.
 */
function kept(g, s, ahead = null) {
  const gr = ahead ? ahead.grid : grid(g);
  if (!gr) return null;
  const { m, w, h, key } = gr;
  let short = false;
  const sized = (cg, cs, k, cw, ch, paint) => {
    if (!ahead) return keep(cg, cs, k, cw, ch, paint);
    if (!has(cs, k, cw, ch) && (short || !ahead.more())) { short = true; return null; }
    return keep(cg, cs, k, cw, ch, (c, x) => { paint(c, x); ahead.made(c.canvas); });
  };
  // Keep the painting, and the ground it was scraped down to, as the wall did.
  const ground = ahead ? ahead.ground : Hg.painting(g, s).ground;
  const plain = sized(g, s, 'plain ' + key, w, h, onSheet(m, (cg, cs) => {
    // The painting without its forms: the impasto and every step, only the halos laid.
    const bs = Object.create(cs);
    bs.shapes = cs.shapes.filter((f) => cs.steps[f.at].wash);
    Sc.paintImpasto(cg, bs);
    for (let j = 0; j < cs.steps.length; j++) Sc.drawStep(cg, bs, j, 1, ground ? { copy: ground, m } : null);
  }));
  if (!plain) return short ? false : null;
  const sprites = s.skins.map((k) => {
    const [x, y, pw, ph] = rectOf(k, m);
    return sized(g, s, `skin ${k.i} ${key}`, pw, ph, (cg, cs) => {
      const at = (c) => c.setTransform(m.a, m.b, m.c, m.d, m.e - x, m.f - y);
      if (!k.glaze) { at(cg); k.f.draw(cg); return; }
      // A glaze carries away the ground and the forms beneath it.
      cg.drawImage(plain, -x, -y);
      at(cg);
      for (const o of cs.skins) if (o.z < k.z && o.box[0] < k.box[2] && o.box[2] > k.box[0] && o.box[1] < k.box[3] && o.box[3] > k.box[1]) o.f.draw(cg);
      k.f.draw(cg);
      // Cut to where the glaze lies, its own alpha made whole four times over.
      const mask = new OffscreenCanvas(pw, ph), mg = mask.getContext('2d');
      at(mg);
      for (let n = 0; n < 4; n++) k.f.draw(mg);
      cg.setTransform(1, 0, 0, 1, 0, 0);
      cg.globalCompositeOperation = 'destination-in';
      cg.drawImage(mask, 0, 0);
    });
  });
  const shades = s.skins.map((k, i) => {
    const [, , pw, ph] = rectOf(k, m), sw = Math.ceil(pw / SOFT) + 4 * BLUR, sh = Math.ceil(ph / SOFT) + 4 * BLUR;
    return sized(g, s, `shade ${k.i} ${key}`, sw, sh, (cg) => {
      if (!sprites[i]) return;
      cg.filter = `blur(${BLUR}px)`;
      cg.drawImage(sprites[i], 2 * BLUR, 2 * BLUR, pw / SOFT, ph / SOFT);
      cg.filter = 'none';
      cg.globalCompositeOperation = 'source-in';
      cg.fillStyle = 'rgb(24, 16, 8)';
      cg.fillRect(0, 0, sw, sh);
    });
  });
  // Each skin's silhouette at half its resolution, in the dark of its edge.
  const edges = s.skins.map((k, i) => {
    const [, , pw, ph] = rectOf(k, m);
    return sized(g, s, `edge ${k.i} ${key}`, Math.ceil(pw / 2), Math.ceil(ph / 2), (cg) => {
      if (!sprites[i]) return;
      cg.drawImage(sprites[i], 0, 0, pw, ph, 0, 0, pw / 2, ph / 2);
      cg.globalCompositeOperation = 'source-in';
      cg.fillStyle = EDGE;
      cg.fillRect(0, 0, pw, ph);
    });
  });
  const bare = sized(g, s, 'bare ' + key, w, h, (cg) => {
    cg.drawImage(plain, 0, 0);
    cg.globalAlpha = STAIN;
    s.skins.forEach((k, i) => { if (sprites[i]) { const [x, y, pw, ph] = rectOf(k, m); cg.drawImage(sprites[i], 0, 0, pw, ph, x, y, pw, ph); } });
  });
  return short ? false : { bare, sprites, shades, edges, m };
}

// Solves whose copies are being made ahead, by the painting's grid, so each is scheduled once.
const preparing = new WeakMap();

/**
 * Make solve `s`'s kept pictures for this canvas while the browser is idle,
 * a few in each idle period, before the frame that first needs them: the
 * painting stays whole until the first form cracks, so the piece's first
 * frames, and the warm-up drawn before its join, lay none of them. Whatever
 * is not made when a frame needs it is made then, the same pixels.
 */
function prepare(g, s) {
  const gr = grid(g);
  if (!gr || typeof requestIdleCallback !== 'function') return;
  let keys = preparing.get(s);
  if (!keys) preparing.set(s, keys = new Set());
  if (keys.has(gr.key)) return;
  keys.add(gr.key);
  const ground = Hg.painting(g, s).ground;
  // A pixel of each copy read back as it is made, so the browser draws it now and not on a frame the visitor sees.
  const sink = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) : null;
  const next = (deadline) => {
    // The ground given up with its solve: the frame that needs the copies makes them.
    if (ground && !ground.width) return;
    const first = { ok: true };
    // One copy at least in each idle period, then more while it lasts.
    const more = () => (first.ok ? !(first.ok = false) : deadline.timeRemaining() > 1);
    // Each copy is read back as it is made, so the time it takes the browser to draw it counts against the idle period.
    const made = (c) => { if (sink) { sink.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1); sink.getImageData(0, 0, 1, 1); } };
    const done = kept(g, s, { grid: gr, ground, more, made }) !== false;
    if (!done) requestIdleCallback(next);
  };
  requestIdleCallback(next);
}

/**
 * Place skin `k` at pose `p` in sheet units: moved by `p.x, p.y`, turned by
 * `p.turn` about its middle and scaled by `sc`.
 */
function place(g, k, x, y, turn, sc) {
  g.translate(k.c[0] + x, k.c[1] + y);
  if (turn) g.rotate(turn);
  if (sc !== 1) g.scale(sc, sc);
  g.translate(-k.c[0], -k.c[1]);
}

/** Lay the painting with no forms on it, in sheet units. */
function drawBare(g, s, pics) {
  if (pics) Dr.put(g, { copy: pics.bare, m: pics.m });
  else Sc.paintGround(g, s);
}

/**
 * Skin `k` in pose `p` = { x, y, turn, h, crack }: `h` units above the
 * painting, lit from angle `light`. Its shadow falls away from the light, the
 * further and softer the higher it is, and its cut edge shows on its shaded
 * side; `crack`, from 0 to 1, is the dark hair opening round a skin still
 * lying where it was painted, as it comes free.
 */
function drawSkin(g, s, pics, k, p, light) {
  const lx = Math.cos(light), ly = Math.sin(light), h = p.h || 0, sc = 1 + h * 0.004;
  const sprite = pics && pics.sprites[k.i];
  if (!sprite) {
    g.save();
    place(g, k, p.x, p.y, p.turn, sc);
    k.f.draw(g);
    g.restore();
    return;
  }
  const [x, y, pw, ph] = rectOf(k, pics.m), u = 1 / pics.m.a, ox = (x - pics.m.e) * u, oy = (y - pics.m.f) * u;
  const shade = pics.shades[k.i], edge = pics.edges[k.i];
  if (shade && h > 0) {
    const d = 0.6 + h * 0.55, sw = Math.ceil(pw / SOFT) + 4 * BLUR, sh = Math.ceil(ph / SOFT) + 4 * BLUR, pad = 2 * BLUR * SOFT * u;
    g.save();
    g.globalAlpha = Math.max(0.25, 0.7 - h * 0.012);
    place(g, k, p.x - lx * d, p.y - ly * d, p.turn, 1 + h * 0.012);
    g.drawImage(shade, 0, 0, sw, sh, ox - pad, oy - pad, sw * SOFT * u, sh * SOFT * u);
    g.restore();
  }
  if (edge) {
    const ew = Math.ceil(pw / 2), eh = Math.ceil(ph / 2);
    const lay = (dx, dy, a) => {
      g.save();
      g.globalAlpha = a;
      place(g, k, p.x + dx, p.y + dy, p.turn, sc);
      g.drawImage(edge, 0, 0, ew, eh, ox, oy, pw * u, ph * u);
      g.restore();
    };
    // The hair opening round it as it comes free; once loose, its edge on the side away from the light.
    if (h <= 0 && p.crack > 0) for (const [dx, dy] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) lay(dx, dy, 0.5 * p.crack);
    else if (h > 0) lay(-lx * 0.9, -ly * 0.9, 0.9);
  }
  g.save();
  place(g, k, p.x, p.y, p.turn, sc);
  g.drawImage(sprite, 0, 0, pw, ph, ox, oy, pw * u, ph * u);
  g.restore();
}

module.exports = { skins, boundsOf, owner, kept, prepare, drawBare, drawSkin, place };
