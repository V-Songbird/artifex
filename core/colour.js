// Colour, in the light it is actually mixed in.
//
// WHY THIS EXISTS. The library documented the bug and then shipped nothing that
// avoids it. SKILL.md's trap list says
//
//   "Display values are not linear light. round(v*255) with no sRGB encode
//    renders a table fitted in linear light a stop dark."
//
// and there was no encoder, no mix, no parse, no luminance anywhere in `core/`.
// Four of five authors handed the library needed to blend two colours; three of
// them wrote the naive version -- the one the trap list warns about -- because
// it is what you write when nothing is there. The fourth wrote the correct one
// and said so in their report.
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

const { clamp01, lerp } = require('./num.js');

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

module.exports = { rgb, hex, mix, luma, contrast, readableOn, toLinear, toSRGB };
