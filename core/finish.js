// A film finish: the process that touched every pixel of a film.
//
// A piece declares it (`finish` in core/piece.js) and drawFrame applies it to
// every raster frame the same way, so a film keeps one treatment from its first
// frame to its last. Each part is optional and off unless declared:
//
//   grain     a seeded noise tile laid over the frame in soft light, at a new
//             offset on every frame, so it boils as film grain does;
//             grainSize makes it coarser or finer than the stock's own;
//   weave     the picture moving a little in the gate from frame to frame;
//   flicker   the exposure dipping a little on some frames;
//   vignette  the corners falling off;
//   grade     one print: where black and white land, a tone every hue is
//             pulled toward while each pixel keeps its lightness, a tone
//             curve per channel, and tints for the shadows and highlights;
//   bloom     the brightest light spreading into a glow around it, as it
//             scatters in the lens and the emulsion;
//   halation  a reddish fringe past the edges of the brightest light, as it
//             reflects off the back of the film into its red layer.
//
// EVERY PART IS A FUNCTION OF (SEED, FRAME). Nothing reads a clock or counts
// calls, so a frame drawn again -- by a scrub, an export or a replay -- is the
// frame it was. The bloom, the halation and the grade's curves and tints are
// functions of the frame's own pixels, which are.
//
// PIXELS ONLY. drawFrame applies it on a surface with a canvas. The vector
// surface, the benchmark's null surface and recording stand-ins draw the
// piece's own marks: an SVG has no pixels to finish, and a count of the
// piece's calls stays the piece's.

'use strict';

const { rng, noise2 } = require('./rand.js');
const { rgb, hex } = require('./colour.js');
const { sibling } = require('./layer.js');

const PARTS = ['grain', 'grainSize', 'weave', 'flicker', 'vignette', 'grade', 'bloom', 'halation'];
const GRADE = ['black', 'white', 'tone', 'toning', 'red', 'green', 'blue', 'shadows', 'highlights'];
const CHANNELS = ['red', 'green', 'blue'];
const CURVE = ['toe', 'mid', 'shoulder'];
const TONES = ['shadows', 'highlights'];
const TINT = ['tint', 'amount'];

// The bloom's copy of the frame holds GLOW pixels on its shorter side at any
// output scale, so the glow spreads over the same share of the frame in a
// preview and in the film. Light blooms above KNEE, a luminance out of 255, and
// more the further above it. SPREAD is the binomial kernel the copy is blurred
// with, across and then down: whole-number weights and no transcendental
// functions, so every engine computes the same sums from the same copy.
const GLOW = 90;
const KNEE = 128;
const SPREAD = [1, 8, 28, 56, 70, 56, 28, 8, 1];

// The halation blurs the same copy with the shorter binomial kernel HALO and
// keeps only the light the blur carried past where it was: a fringe outside
// bright edges, about 2 % of the frame's shorter side wide, in HALATION's
// red-orange, whatever the light's own colour.
const HALO = [1, 4, 6, 4, 1];
const HALATION = [1, 0.3, 0.1];

// The grain tile, in texels a side. The frame's shorter side holds STOCK texels
// at any output scale: grain belongs to the film stock, so a larger export
// resolves the same grain rather than finer grain.
// A piece may declare a coarser or finer stock: grainSize multiplies the grain,
// within GRAIN. Under 0.5 a grain is smaller than a pixel of a 1080 export and
// averages away; over 6 it reads as blotches, not grain.
const TILE = 512;
const STOCK = 720;
const GRAIN = [0.5, 6];

// The deepest flicker. Black at this alpha lowers white's relative luminance by
// 0.056, 0.060 with a level of 8-bit rounding, and any darker pixel by less, so
// no area of any frame dips by the 0.1 a general flash needs (WCAG 2.3.1); pure
// red's (R - G - B) x 320 falls by 19.3 at most, within the 20 of WCAG 2.0's red
// flash; its u'v' chromaticity, WCAG 2.2's red measure, moved under 0.001.
// At 0.04 pure red flashed 4 times a second at 24 fps by WCAG 2.0's measure.
const FLICKER = 0.025;

const unit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

/** Why a declared finish is invalid, or null. The validator for FIELDS.finish. */
function check(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `must be null or { ${PARTS.join(', ')} }`;
  const extra = Object.keys(v).filter((k) => !PARTS.includes(k));
  if (extra.length) return `unknown key(s) in finish: ${extra.join(', ')}; known: ${PARTS.join(', ')}`;
  for (const k of ['grain', 'vignette', 'bloom', 'halation']) {
    if (k in v && !unit(v[k])) return `finish.${k} must be a number in [0, 1]`;
  }
  if ('grainSize' in v && !(Number.isFinite(v.grainSize) && v.grainSize >= GRAIN[0] && v.grainSize <= GRAIN[1])) {
    return `finish.grainSize must be a number in [${GRAIN[0]}, ${GRAIN[1]}]: how many times the stock's own grain`;
  }
  if ('flicker' in v && !(unit(v.flicker) && v.flicker <= FLICKER)) {
    return `finish.flicker must be a number in [0, ${FLICKER}]: a deeper dip can flash the whole frame`;
  }
  if ('weave' in v && !(Number.isFinite(v.weave) && v.weave >= 0)) {
    return 'finish.weave must be a non-negative number of design units';
  }
  if (!('grade' in v)) return null;
  const d = v.grade;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return `finish.grade must be { ${GRADE.join(', ')} }`;
  const odd = Object.keys(d).filter((k) => !GRADE.includes(k));
  if (odd.length) return `unknown key(s) in finish.grade: ${odd.join(', ')}; known: ${GRADE.join(', ')}`;
  for (const k of ['black', 'white', 'tone']) {
    if (k in d && !/^#[0-9a-f]{6}$/i.test(d[k])) return `finish.grade.${k} must be a #rrggbb colour`;
  }
  if (('tone' in d) !== ('toning' in d)) return 'finish.grade: tone and toning come together, the colour and how far toward it';
  if ('toning' in d && !unit(d.toning)) return 'finish.grade.toning must be a number in [0, 1]';
  const [B, W] = ends(d);
  if (![0, 1, 2].every((i) => W[i] > B[i])) return 'finish.grade.white must be lighter than finish.grade.black in every channel';
  for (const k of CHANNELS.filter((c) => c in d)) {
    const c = d[k], name = `finish.grade.${k}`;
    const why = shape(c, CURVE, name);
    if (why) return why;
    for (const q of ['toe', 'shoulder']) if (q in c && !unit(c[q])) return `${name}.${q} must be a number in [0, 1]`;
    if ('mid' in c && !(unit(c.mid) && c.mid > 0 && c.mid < 1)) return `${name}.mid must be a number between 0 and 1, not either end`;
  }
  for (const k of TONES.filter((t) => t in d)) {
    const t = d[k], name = `finish.grade.${k}`;
    const why = shape(t, TINT, name);
    if (why) return why;
    if (!/^#[0-9a-f]{6}$/i.test(t.tint)) return `${name}.tint must be a #rrggbb colour`;
    if (!unit(t.amount)) return `${name}.amount must be a number in [0, 1]`;
  }
  return null;
}

/** Why `v`, declared at `name`, is not an object of `known` keys, or null. */
function shape(v, known, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `${name} must be { ${known.join(', ')} }`;
  const odd = Object.keys(v).filter((k) => !known.includes(k));
  return odd.length ? `unknown key(s) in ${name}: ${odd.join(', ')}; known: ${known.join(', ')}` : null;
}

const ends = (d) => [rgb(d.black || '#000000'), rgb(d.white || '#ffffff')];

// Per solve: its addressed source and its grain tile, released with the solve.
const solves = new WeakMap();

function source(solved) {
  let s = solves.get(solved.state);
  if (!s) solves.set(solved.state, s = { R: rng(solved.seed), tile: null });
  return s;
}

/** Where the gate holds frame `frame`: an offset in design units, at most `weave` across and half of it down. */
function gate(R, weave, frame) {
  // A slow wander with a little jitter on top, each in [-1, 1).
  const wander = (name) => 0.7 * (2 * noise2(R, frame * 0.37, 0.5, name) - 1) + 0.3 * (2 * R(name, 'jitter', frame) - 1);
  return [weave * wander('finish weave x'), 0.5 * weave * wander('finish weave y')];
}

/**
 * Before `draw`: move the picture in the gate. It is enlarged about its middle
 * just enough that no offset the weave can reach uncovers an edge.
 */
function weave(g, piece, solved, frame) {
  const a = piece.finish.weave;
  if (!a) return;
  const { w, h } = piece.size;
  const [dx, dy] = gate(source(solved).R, a, frame);
  const z = 1 + (2 * a) / Math.min(w, h);
  g.translate(w / 2 + dx, h / 2 + dy);
  g.scale(z, z);
  g.translate(-w / 2, -h / 2);
}

/**
 * After `draw`: bloom and halation, grain, the print grade, flicker and the
 * vignette, in design units at `scale`. The bloom and the halation come first,
 * from the picture's own light as the lens and the emulsion spread it: so the
 * grain's boil never reaches their knee and the glow changes only as the
 * picture does, and the grade, flicker and vignette then treat the glow as they
 * treat the rest of the picture. The grade tones, then curves and tints, then
 * lands black and white, so its ends stay where it declares them.
 */
function develop(g, piece, solved, frame, scale) {
  const f = piece.finish;
  const { w, h } = piece.size;
  const s = source(solved);
  const pass = (op, alpha, style, x = 0, y = 0, pw = w, ph = h) => {
    g.globalCompositeOperation = op;
    g.globalAlpha = alpha;
    g.fillStyle = style;
    g.fillRect(x, y, pw, ph);
  };
  g.save();
  try {
    g.scale(scale, scale);
    if (f.bloom || f.halation) bloom(g, f, s, w, h);
    if (f.grain) {
      if (!s.tile) s.tile = tile(g, s.R);
      const k = (f.grainSize || 1) * Math.min(w, h) / STOCK;
      const ox = Math.floor(s.R('finish grain', 'x', frame) * TILE);
      const oy = Math.floor(s.R('finish grain', 'y', frame) * TILE);
      g.save();
      g.scale(k, k);
      g.translate(-ox, -oy);
      pass('soft-light', f.grain, g.createPattern(s.tile, 'repeat'), ox, oy, w / k, h / k);
      g.restore();
    }
    const d = f.grade;
    if (d && d.toning) pass('color', d.toning, d.tone);
    if (d && [...CHANNELS, ...TONES].some((k) => k in d)) print(g, d, s, w, h);
    if (d && (d.black || d.white)) {
      // Multiply by (white - black) / (1 - black), then screen black: each
      // channel's 0 lands on black and its 1 on white, straight between.
      const [B, W] = ends(d);
      pass('multiply', 1, hex([0, 1, 2].map((i) => (W[i] - B[i]) / (1 - B[i]))));
      pass('screen', 1, hex(B));
    }
    if (f.flicker) pass('source-over', f.flicker * s.R('finish flicker', 'dip', frame), '#000000');
    if (f.vignette) {
      // An ellipse the frame's shape: clear inside half its size, darkest in the corners.
      g.translate(w / 2, h / 2);
      g.scale(w / 2, h / 2);
      const v = g.createRadialGradient(0, 0, 0.5, 0, 0, Math.SQRT2);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, '#000000');
      pass('source-over', f.vignette, v, -1, -1, 2, 2);
    }
  } finally {
    g.restore();
  }
}

/**
 * The grade's curves and tints, on the frame's own pixels: copied 1:1 into a
 * canvas kept for reading, so the frame's own canvas stays where the browser
 * keeps it, mapped through the solve's tables, and drawn back in place. Both
 * copies are of whole device pixels, at no transform: at a scale that does not
 * divide the design size, w x h covers the canvas's last row and column only
 * in part, and a 'copy' drawn back in design units would half clear them.
 */
function print(g, d, s, w, h) {
  const m = g.getTransform();
  const x = Math.round(m.e), y = Math.round(m.f);
  const pw = Math.max(1, Math.round(w * m.a));
  const ph = Math.max(1, Math.round(h * m.d));
  if (!s.print || s.print.width !== pw || s.print.height !== ph) {
    s.print = sibling(g.canvas, pw, ph);
    if (!s.print) throw new Error('finish: this surface has a canvas but no way to make another, so its grade cannot be drawn');
  }
  if (!s.tables) s.tables = tables(d);
  const t = s.print.getContext('2d', { willReadFrequently: true });
  t.globalCompositeOperation = 'copy';
  t.imageSmoothingEnabled = false;
  t.drawImage(g.canvas, x, y, pw, ph, 0, 0, pw, ph);
  const img = t.getImageData(0, 0, pw, ph);
  graded(img.data, s.tables);
  t.putImageData(img, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.rect(x, y, pw, ph);
  g.clip();
  g.globalCompositeOperation = 'copy';
  g.globalAlpha = 1;
  g.imageSmoothingEnabled = false;
  g.drawImage(s.print, x, y, pw, ph);
  g.restore();
}

/**
 * A grade's curve tables, one per channel, and its tints' offsets by
 * luminance: a shadow tint weighs amount x (1 - L)^2 and a highlight tint
 * amount x L^2 at luminance L in [0, 1], and each moves a pixel by its tint's
 * difference from its own luminance, so the tint changes the hue and not the
 * lightness. Every value is in levels of 255.
 */
function tables(d) {
  const tint = (k, weigh) => {
    const c = d[k] ? rgb(d[k].tint).map((v) => 255 * v) : [0, 0, 0];
    const Y = (54 * c[0] + 183 * c[1] + 19 * c[2]) / 256;
    const amount = d[k] ? d[k].amount : 0;
    return (l, q) => amount * weigh(l / 255) * (c[q] - Y);
  };
  const shadow = tint('shadows', (L) => (1 - L) * (1 - L));
  const highlight = tint('highlights', (L) => L * L);
  // Whole levels, so the pass over every pixel is integer arithmetic.
  return {
    curves: CHANNELS.map((k) => Uint8ClampedArray.from(curve(d[k]))),
    offsets: [0, 1, 2].map((q) => Int16Array.from({ length: 256 }, (_, l) => Math.round(shadow(l, q) + highlight(l, q)))),
  };
}

/**
 * The curve through (0, 0), (0.5, mid) and (1, 1), as 256 outputs in levels
 * of 255: two cubic Hermite spans, whose slope at black is the first span's
 * mean slope times (1 - toe), at white the second's times (1 - shoulder), and
 * at the middle the harmonic mean of the two. Each span's end slopes are at
 * most twice its mean, so the curve never turns back (Fritsch and Carlson).
 * At its defaults, toe 0, mid 0.5, shoulder 0, it is the straight line.
 */
function curve({ toe = 0, mid = 0.5, shoulder = 0 } = {}) {
  const s0 = 2 * mid, s1 = 2 * (1 - mid), sm = s0 * s1;
  const span = (t, y0, y1, d0, d1) => {
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + 0.5 * (t3 - 2 * t2 + t) * d0 + (3 * t2 - 2 * t3) * y1 + 0.5 * (t3 - t2) * d1;
  };
  return Float64Array.from({ length: 256 }, (_, v) => 255 * (v <= 127.5
    ? span((2 * v) / 255, 0, mid, s0 * (1 - toe), sm)
    : span((2 * v) / 255 - 1, mid, 1, sm, s1 * (1 - shoulder))));
}

/** The RGBA `px` through the grade's `tables`, in place: each channel through its curve, then the tints at the result's luminance. */
function graded(px, { curves: [R, G, B], offsets: [or, og, ob] }) {
  for (let i = 0; i < px.length; i += 4) {
    const r = R[px[i]], gr = G[px[i + 1]], b = B[px[i + 2]];
    const l = (54 * r + 183 * gr + 19 * b + 128) >> 8;
    px[i] = r + or[l];
    px[i + 1] = gr + og[l];
    px[i + 2] = b + ob[l];
  }
}

/**
 * The frame's light above KNEE spread around it: read at half size, kept where
 * it passes the knee, averaged into a small copy, and blurred into a glow that
 * is added back over the frame at alpha `f.bloom`, or into a fringe past its
 * edges added at alpha `f.halation`. Both come from the one read.
 */
function bloom(g, f, s, w, h) {
  const m = g.getTransform();
  const hw = Math.max(1, Math.round((w * m.a) / 2));
  const hh = Math.max(1, Math.round((h * m.d) / 2));
  const k = GLOW / Math.min(w, h);
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  let b = s.bloom;
  if (!b || b.half.width !== hw || b.half.height !== hh || b.copy.width !== cw || b.copy.height !== ch) {
    const half = sibling(g.canvas, hw, hh);
    const copy = sibling(g.canvas, cw, ch);
    if (!half || !copy) throw new Error(`finish: this surface has a canvas but no way to make another, so its ${f.bloom ? 'bloom' : 'halation'} cannot be drawn`);
    s.bloom = b = { half, copy, fringe: sibling(g.canvas, cw, ch) };
  }
  // Halving with bilinear smoothing averages each 2 x 2 block, so a point of
  // light keeps its brightness for the knee instead of being averaged away.
  const t = b.half.getContext('2d', { willReadFrequently: true });
  t.globalCompositeOperation = 'copy';
  t.imageSmoothingEnabled = true;
  t.imageSmoothingQuality = 'low';
  t.drawImage(g.canvas, m.e, m.f, w * m.a, h * m.d, 0, 0, hw, hh);
  const lit = light(t.getImageData(0, 0, hw, hh).data, hw, hh, cw, ch);
  const add = (canvas, amount, into) => {
    const c = canvas.getContext('2d');
    const img = c.createImageData(cw, ch);
    into(lit, cw, ch, img.data);
    c.putImageData(img, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = amount;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    g.drawImage(canvas, 0, 0, w, h);
  };
  if (f.bloom) add(b.copy, f.bloom, spread);
  if (f.halation) add(b.fringe, f.halation, fringe);
}

/**
 * The share of a pixel's colour that blooms, from its alpha `a` in [0, 1] and
 * its weighted colour sum `S`, 54 R + 183 G + 19 B: none at or below KNEE, and
 * more the further its light passes it. The bytes are unpremultiplied: a faint
 * pixel's light is its colour times its alpha.
 */
function knee(a, S) {
  const L = (a * S) / 256;
  if (L <= KNEE) return 0;
  return (a * (L - KNEE)) / (255 - KNEE);
}
let opaque = null;

/** Into `out`, the cw x ch RGBA glow of the sw x sh RGBA `src`: its light above KNEE, averaged, then blurred across and down. */
const glow = (src, sw, sh, out, cw, ch) => spread(light(src, sw, sh, cw, ch), cw, ch, out);

/** Into `out`, the cw x ch RGBA halation of the sw x sh RGBA `src`: the fringe its light above KNEE casts past its edges. */
const halo = (src, sw, sh, out, cw, ch) => fringe(light(src, sw, sh, cw, ch), cw, ch, out);

/** The cw x ch three-channel light above KNEE of the sw x sh RGBA `src`, each sample the mean of its block. */
function light(src, sw, sh, cw, ch) {
  // Most pixels are opaque, so their shares are looked up by colour sum, computed once.
  if (!opaque) opaque = Float64Array.from({ length: 255 * 256 + 1 }, (_, S) => knee(1, S));
  const block = (i, n, of) => [Math.floor((i * n) / of), Math.max(Math.floor((i * n) / of) + 1, Math.floor(((i + 1) * n) / of))];
  const lit = new Float64Array(3 * cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    const [y0, y1] = block(cy, sh, ch);
    for (let cx = 0; cx < cw; cx++) {
      const [x0, x1] = block(cx, sw, cw);
      let r = 0, gr = 0, b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0, i = 4 * (y * sw + x0); x < x1; x++, i += 4) {
          const A = src[i + 3], S = 54 * src[i] + 183 * src[i + 1] + 19 * src[i + 2];
          const k = A === 255 ? opaque[S] : knee(A / 255, S);
          if (!k) continue;
          r += src[i] * k;
          gr += src[i + 1] * k;
          b += src[i + 2] * k;
        }
      }
      const o = 3 * (cy * cw + cx), n = (y1 - y0) * (x1 - x0);
      lit[o] = r / n;
      lit[o + 1] = gr / n;
      lit[o + 2] = b / n;
    }
  }
  return lit;
}

/** Into `out`, the glow of `lit`: blurred across and down with SPREAD. */
function spread(lit, cw, ch, out) {
  const across = blur(lit, cw, ch, true);
  const down = blur(across, cw, ch, false);
  const total = SPREAD.reduce((a, v) => a + v) ** 2;
  for (let i = 0; i < cw * ch; i++) {
    for (let q = 0; q < 3; q++) out[4 * i + q] = Math.round(down[3 * i + q] / total);
    out[4 * i + 3] = 255;
  }
}

/**
 * Into `out`, the halation of `lit`: where blurring it with HALO raises a
 * sample's luminance, the rise, in HALATION's colour. Inside an even light and
 * in the dark away from it the blur changes nothing, so the fringe lies just
 * past the light's edges.
 */
function fringe(lit, cw, ch, out) {
  const down = blur(blur(lit, cw, ch, true, HALO), cw, ch, false, HALO);
  const total = HALO.reduce((a, v) => a + v) ** 2;
  const Y = (a, i, k) => (54 * a[i] + 183 * a[i + 1] + 19 * a[i + 2]) / k;
  for (let i = 0; i < cw * ch; i++) {
    const rise = Math.max(0, Y(down, 3 * i, 256 * total) - Y(lit, 3 * i, 256));
    for (let q = 0; q < 3; q++) out[4 * i + q] = Math.round(rise * HALATION[q]);
    out[4 * i + 3] = 255;
  }
}

/** One pass of the kernel K over three-channel samples, across the rows or down the columns, holding the edge sample past each end. */
function blur(a, cw, ch, across, K = SPREAD) {
  const r = (K.length - 1) / 2;
  const [len, lines, step, stride] = across ? [cw, ch, 3, 3 * cw] : [ch, cw, 3 * cw, 3];
  const b = new Float64Array(a.length);
  for (let line = 0; line < lines; line++) {
    const o = line * stride;
    for (let i = 0; i < len; i++) {
      let x = 0, y = 0, z = 0;
      for (let j = -r; j <= r; j++) {
        const q = o + step * Math.min(len - 1, Math.max(0, i + j));
        const k = K[j + r];
        x += k * a[q];
        y += k * a[q + 1];
        z += k * a[q + 2];
      }
      const p = o + step * i;
      b[p] = x;
      b[p + 1] = y;
      b[p + 2] = z;
    }
  }
  return b;
}

/** The seed's grain: TILE x TILE grey texels about mid-grey, the neutral of soft light. */
function tile(g, R) {
  const c = sibling(g.canvas, TILE, TILE);
  if (!c) throw new Error('finish: this surface has a canvas but no way to make another, so its grain cannot be drawn');
  const t = c.getContext('2d');
  const img = t.createImageData(TILE, TILE);
  for (let i = 0; i < TILE * TILE; i++) {
    // Two uniforms summed: most texels near the middle, a few far out.
    const v = 128 + Math.round(127 * (R('finish grain', 'a', i) + R('finish grain', 'b', i) - 1));
    img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = 255;
  }
  t.putImageData(img, 0, 0);
  return c;
}

module.exports = { check, weave, develop, gate, glow, halo, curve, FLICKER };
