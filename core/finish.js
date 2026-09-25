// A film finish: the process that touched every pixel of a film.
//
// A piece declares it (`finish` in core/piece.js) and drawFrame applies it to
// every raster frame the same way, so a film keeps one treatment from its first
// frame to its last. Each part is optional and off unless declared:
//
//   grain     a seeded noise tile laid over the frame in soft light, at a new
//             offset on every frame, so it boils as film grain does;
//   weave     the picture moving a little in the gate from frame to frame;
//   flicker   the exposure dipping a little on some frames;
//   vignette  the corners falling off;
//   grade     one print: where black and white land, and a tone every hue is
//             pulled toward while each pixel keeps its lightness.
//
// EVERY PART IS A FUNCTION OF (SEED, FRAME). Nothing reads a clock or counts
// calls, so a frame drawn again -- by a scrub, an export or a replay -- is the
// frame it was.
//
// PIXELS ONLY. drawFrame applies it on a surface with a canvas. The vector
// surface, the benchmark's null surface and recording stand-ins draw the
// piece's own marks: an SVG has no pixels to finish, and a count of the
// piece's calls stays the piece's.

'use strict';

const { rng, noise2 } = require('./rand.js');
const { rgb, hex } = require('./colour.js');
const { sibling } = require('./layer.js');

const PARTS = ['grain', 'weave', 'flicker', 'vignette', 'grade'];
const GRADE = ['black', 'white', 'tone', 'toning'];

// The grain tile, in texels a side. The frame's shorter side holds STOCK texels
// at any output scale: grain belongs to the film stock, so a larger export
// resolves the same grain rather than finer grain.
const TILE = 512;
const STOCK = 720;

const unit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

/** Why a declared finish is invalid, or null. The validator for FIELDS.finish. */
function check(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `must be null or { ${PARTS.join(', ')} }`;
  const extra = Object.keys(v).filter((k) => !PARTS.includes(k));
  if (extra.length) return `unknown key(s) in finish: ${extra.join(', ')}; known: ${PARTS.join(', ')}`;
  for (const k of ['grain', 'flicker', 'vignette']) {
    if (k in v && !unit(v[k])) return `finish.${k} must be a number in [0, 1]`;
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
  return null;
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

/** After `draw`: grain, the print grade, flicker and the vignette, in design units at `scale`. */
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
    if (f.grain) {
      if (!s.tile) s.tile = tile(g, s.R);
      const k = Math.min(w, h) / STOCK;
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

module.exports = { check, weave, develop, gate };
