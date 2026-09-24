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
  const [r, g, b] = rgb(colour).slice(0, 3).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, Math.hypot(A, B), Math.atan2(B, A)];
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

module.exports = { rgb, hex, mix, mixOklch, oklch, luma, contrast, readableOn, toLinear, toSRGB };
