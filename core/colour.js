// Colour, in the light it is actually mixed in.
//
// A midpoint mixed in display space is darker than the light between the two
// colours actually is. That is not a preference, it is the difference between
// averaging numbers and averaging photons, and it shows most on the mixes
// people reach for first: a ramp between two saturated hues, a wash over a
// ground, a value scale.
//
// Nothing here knows what kind of art a piece makes. There is no palette, no
// harmony rule and no "good" colour in this file, because those are art
// direction and belong in a preset a piece opts into.

'use strict';

const { clamp01, lerp, turn } = require('./num.js');

/** sRGB display value in [0,1] to linear light. */
function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light to an sRGB display value in [0,1]. */
function toSRGB(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** "#rgb", "#rrggbb" or "#rrggbbaa" to [r, g, b, a], each in [0,1]. */
function rgb(hex) {
  const s = String(hex).trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) {
    throw new Error(`colour: expected #rgb, #rrggbb or #rrggbbaa, got ${JSON.stringify(hex)}`);
  }
  const wide = s.length > 4;
  const step = wide ? 2 : 1;
  const out = [];
  for (let i = 0; i < s.length; i += step) {
    const part = wide ? s.slice(i, i + 2) : s[i] + s[i];
    out.push(parseInt(part, 16) / 255);
  }
  if (out.length === 3) out.push(1);
  return out;
}

/** [r, g, b] or [r, g, b, a] in [0,1] back to a hex string. */
function hex(c) {
  const byte = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  const a = c.length > 3 && c[3] < 1 ? byte(c[3]) : '';
  return `#${byte(c[0])}${byte(c[1])}${byte(c[2])}${a}`;
}

/**
 * Mix two colours IN LINEAR LIGHT and hand back a display value.
 *
 * `mix('#000', '#fff', 0.5)` is `#bcbcbc`, not `#808080`. The second is the
 * average of two numbers; the first is the colour of half the light.
 */
function mix(a, b, u) {
  const x = rgb(a);
  const y = rgb(b);
  const k = clamp01(u);
  return hex([
    toSRGB(lerp(toLinear(x[0]), toLinear(y[0]), k)),
    toSRGB(lerp(toLinear(x[1]), toLinear(y[1]), k)),
    toSRGB(lerp(toLinear(x[2]), toLinear(y[2]), k)),
    lerp(x[3], y[3], k),
  ]);
}

// OKLab, with the matrices Björn Ottosson published with it: "A perceptual
// color space for image processing" (2020), https://bottosson.github.io/posts/oklab/

/** A colour to OKLCh: [lightness 0..1, chroma, hue in radians from atan2]. */
function oklch(colour) {
  return oklchOfLinear(rgb(colour).slice(0, 3).map(toLinear));
}

function oklchOfLinear(c) {
  const [L, A, B] = oklabOfLinear(c);
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** Linear-light [r, g, b] to OKLab [L, a, b]. */
function oklabOfLinear([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** OKLCh back to linear light [r, g, b], which may lie outside [0,1]. */
function linearOf(L, C, h) {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

// A colour inside sRGB comes back from the round trip less than 2e-7 outside it.
const inGamut = (lin) => lin.every((v) => v > -1e-6 && v < 1 + 1e-6);

/**
 * Mix two colours along OKLCh, so a dissolve KEEPS ITS COLOUR on the way.
 *
 * `mix` travels a straight line through the light, and between complementary
 * colours that line crosses grey: yellow to blue passes through a flat khaki.
 * Here lightness and chroma move evenly and the hue turns the short way round,
 * so yellow to blue passes through green instead. That is a colour neither end
 * has, which is the price, and why this is a choice and `mix` stays the default.
 *
 * A grey has no hue and takes the other colour's, so it fades straight in. Where
 * the turn leaves what sRGB can show, chroma gives way, never lightness or hue.
 */
function mixOklch(a, b, u) {
  const x = rgb(a);
  const y = rgb(b);
  const k = clamp01(u);
  const p = oklch(a);
  const q = oklch(b);
  // Rounding leaves an sRGB grey under 1e-7 of chroma and a random hue; one
  // 8-bit step off grey already has 1e-3.
  if (p[1] < 1e-4) p[2] = q[2];
  if (q[1] < 1e-4) q[2] = p[2];
  const L = lerp(p[0], q[0], k);
  const h = p[2] + turn(p[2], q[2]) * k;
  let C = lerp(p[1], q[1], k);
  if (!inGamut(linearOf(L, C, h))) {
    let lo = 0;
    for (let i = 0; i < 24; i++) {
      const c = (lo + C) / 2;
      if (inGamut(linearOf(L, c, h))) lo = c; else C = c;
    }
    C = lo;
  }
  return hex([...linearOf(L, C, h).map(toSRGB), lerp(x[3], y[3], k)]);
}

/**
 * Mix two colours AS PAINTS: each pigment absorbs light, so the mix keeps
 * what both reflect. A weighted geometric mean of each linear channel, so
 * yellow and blue make green and red and blue a dull purple, darker than
 * either light mix. No real pigment reflects nothing, so a channel is held
 * at 0.001 before mixing; without it, any share of a pure primary is black.
 */
function mixPigment(a, b, u) {
  const x = rgb(a);
  const y = rgb(b);
  const k = clamp01(u);
  if (k === 0) return hex(x);
  if (k === 1) return hex(y);
  const ch = (p, q) => (p === q ? p : Math.exp(lerp(Math.log(Math.max(1e-3, p)), Math.log(Math.max(1e-3, q)), k)));
  return hex([0, 1, 2].map((i) => toSRGB(ch(toLinear(x[i]), toLinear(y[i])))).concat(lerp(x[3], y[3], k)));
}

// The tables of mixSpectral, sampled every 10 nm from 380 to 730 nm and written
// by tests/fixtures/spectral-tables.js, which derives them from published
// methods and which tests/colour-spectral.test.js holds them to.
//
// OBSERVER[c][i]: how much linear sRGB channel c a surface reflecting only
// wavelength i sends back under daylight (the CIE 1931 observer, D65). Each row
// sums to 1, so a surface that reflects everything is white.
const OBSERVER = [
  [
    -0.000147, -0.000267, 0.000405, 0.004581, 0.010821, 0.014619, 0.026632, 0.019332, -0.000917, -0.017675, -0.031991, -0.046962,
    -0.065315, -0.080865, -0.0894, -0.085457, -0.055279, -0.012437, 0.040621, 0.095151, 0.148824, 0.179265, 0.208375, 0.209597,
    0.181958, 0.13583, 0.095522, 0.057013, 0.031817, 0.016182, 0.006767, 0.002329, 0.000799, 0.00023, 0.000039, 0.000003,
  ],
  [
    0.000026, 0.000008, -0.000493, -0.002944, -0.008765, -0.015401, -0.023809, -0.021787, -0.01097, 0.003925, 0.021581, 0.039842,
    0.064463, 0.094644, 0.124997, 0.15039, 0.149739, 0.142241, 0.120612, 0.094182, 0.067452, 0.037039, 0.014196, -0.002579,
    -0.010471, -0.011167, -0.008862, -0.005232, -0.002518, -0.000849, -0.000037, 0.000175, 0.000176, 0.000119, 0.000052, 0.000027,
  ],
  [
    0.000335, 0.001124, 0.005063, 0.018872, 0.061558, 0.121288, 0.183528, 0.209925, 0.19749, 0.148004, 0.091474, 0.046489,
    0.022798, 0.006567, -0.004959, -0.012492, -0.015553, -0.01668, -0.015607, -0.013627, -0.011448, -0.008282, -0.006017, -0.00394,
    -0.002388, -0.001362, -0.000831, -0.000503, -0.000331, -0.000223, -0.000133, -0.000069, -0.000038, -0.00002, -0.000007, -0.000003,
  ],
];
// PRIMARY[c][i]: the share of wavelength i that sRGB red and green reflect, as
// the smoothest curves that stay in [0,1], come back through OBSERVER as the
// primary itself, and with blue's sum to 1. Blue is therefore what they leave.
const PRIMARY = [
  [
    0.038653, 0.038859, 0.039508, 0.040538, 0.039624, 0.035157, 0.029576, 0.02035, 0.015943, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0.003564, 0.206169, 0.498739, 0.743906, 0.929405,
    0.994362, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  ],
  [
    0, 0, 0, 0, 0, 0, 0, 0, 0.01402, 0.129234, 0.298011, 0.492033,
    0.680158, 0.839091, 0.95002, 1, 1, 1, 1, 0.996436, 0.793831, 0.501261, 0.189643, 0.011315,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
];
// No paint reflects nothing: every curve is lifted to this floor before mixing
// and lowered again after, so a colour mixed with itself is still itself.
const PAINT_FLOOR = 0.003;
// A dark paint is strong. Each paint's share is squared and weighted by its
// luminance, held at this floor, so the half-and-half sits near the visual
// middle instead of at the darker paint.
const STRENGTH_FLOOR = 0.013;

/**
 * Mix two colours AS PAINTS ACROSS THE SPECTRUM, by Kubelka and Munk's
 * single-constant theory: each colour becomes a reflectance curve, the curves'
 * absorption-to-scattering ratios `(1 - R)² / 2R` are averaged, and the mix's
 * curve is read back as a colour under daylight.
 *
 * Blue `#002185` and yellow `#fcd200` make green `#5c9440`, where `mixPigment`
 * gives a darker `#315921`, and a red let down with white stays a clean pink
 * instead of greying. It reads 36 samples a call, two to four times the cost
 * of `mixPigment`: build a ramp once rather than mixing per pixel.
 *
 * Where the mix leaves sRGB, chroma gives way, never lightness or hue.
 */
function mixSpectral(a, b, u) {
  const x = rgb(a);
  const y = rgb(b);
  const k = clamp01(u);
  if (k === 0) return hex(x);
  if (k === 1) return hex(y);
  const p = x.slice(0, 3).map(toLinear);
  const q = y.slice(0, 3).map(toLinear);
  const wa = (1 - k) ** 2 * Math.max(STRENGTH_FLOOR, luma(a));
  const wb = k ** 2 * Math.max(STRENGTH_FLOOR, luma(b));
  const lift = (v) => PAINT_FLOOR + (1 - PAINT_FLOOR) * v;
  const ks = (r) => (1 - r) ** 2 / (2 * r);
  let lin = [0, 0, 0];
  for (let i = 0; i < 36; i++) {
    const red = PRIMARY[0][i];
    const green = PRIMARY[1][i];
    const blue = 1 - red - green;
    const m = (wa * ks(lift(p[0] * red + p[1] * green + p[2] * blue)) + wb * ks(lift(q[0] * red + q[1] * green + q[2] * blue))) / (wa + wb);
    const r = (1 + m - Math.sqrt(m * m + 2 * m) - PAINT_FLOOR) / (1 - PAINT_FLOOR);
    for (let c = 0; c < 3; c++) lin[c] += OBSERVER[c][i] * r;
  }
  if (!inGamut(lin)) {
    const [L, C, h] = oklchOfLinear(lin);
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const c = (lo + hi) / 2;
      if (inGamut(linearOf(L, c, h))) lo = c; else hi = c;
    }
    lin = linearOf(L, lo, h);
  }
  return hex([...lin.map(toSRGB), lerp(x[3], y[3], k)]);
}

/** Relative luminance, as WCAG defines it: linear light, weighted. */
function luma(colour) {
  const c = rgb(colour);
  return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
}

/** WCAG contrast ratio between two colours, 1 to 21. Order does not matter. */
function contrast(a, b) {
  const x = luma(a);
  const y = luma(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Whichever of `options` stands out most against `ground`.
 *
 * A measurement, not a guess. A piece that puts a mark on a generated field
 * cannot know in advance which way the field went.
 */
function readableOn(ground, options) {
  let best = options[0];
  let score = -1;
  for (const o of options) {
    const c = contrast(ground, o);
    if (c > score) { score = c; best = o; }
  }
  return best;
}

/**
 * Extended Reinhard: `x (1 + x / white²) / (1 + x)`. It keeps the low end
 * nearly linear, rolls the top off, and lands `white` exactly on 1; above it,
 * the result passes 1 and clips. `white` of Infinity is plain `x / (1 + x)`.
 */
function reinhard(x, white) {
  return x * (1 + x / (white * white)) / (1 + x);
}

/**
 * A tone curve for a high-range field -- counts, energies, summed light --
 * returning `(v) => [0,1]`.
 *
 * Exposure comes from the field's average: `v` is scaled by
 * `exposure * key / average`, so a value at the average lands near `key`
 * before the roll-off, then `reinhard` maps it. The average skips zeros,
 * because in an accumulated field a zero is a cell nothing reached, not a dark
 * one. `white` is in field units and defaults to the field's peak, so nothing
 * clips; a lower `white` clips everything above it to 1.
 *
 * The result is linear light. Pass it through `toSRGB` before using it as a
 * position on a ramp authored by eye, or the low end sinks into the ground.
 */
function toneMap(values, { key = 0.5, exposure = 1, white } = {}) {
  for (const [name, v] of [['key', key], ['exposure', exposure], ['white', white === undefined ? 1 : white]]) {
    if (!(v > 0) || !Number.isFinite(v)) throw new Error(`toneMap: ${name} must be a positive finite number, got ${v}`);
  }
  let sum = 0;
  let lit = 0;
  let peak = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!(v > 0)) continue;
    sum += v;
    lit++;
    if (v > peak) peak = v;
  }
  const scale = lit ? exposure * key * lit / sum : 1;
  const top = (white === undefined ? peak : white) * scale || 1;
  // Reinhard's denominator turns negative below -1, so a value at or under 0
  // (or NaN) is dark rather than folded round to white.
  return (v) => (v > 0 ? clamp01(reinhard(v * scale, top)) : 0);
}

module.exports = { rgb, hex, mix, mixOklch, mixPigment, mixSpectral, oklch, oklabOfLinear, luma, contrast, readableOn, toLinear, toSRGB, reinhard, toneMap };
