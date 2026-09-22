// Shared scalar arithmetic and distribution helpers.
//
// Nothing here knows what kind of art a piece makes, and nothing here has a
// default that only makes sense for one kind. That is the bar for `core/`.
//
// The distribution helpers take a value from `R`, never an address. There is
// exactly one addressing vocabulary in this library and it lives in rand.js;
// a second one that wrapped it would be a second place to look.

'use strict';

/** Hold v inside [lo, hi]. */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Hold v inside [0, 1]. */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Straight line from a to b. `lerp(2, 9, u)` is a range, so there is no `range`. */
function lerp(a, b, u) {
  return a + (b - a) * u;
}

/** Where v sits between a and b, as [0, 1]. The inverse of lerp, clamped. */
function unlerp(a, b, v) {
  return a === b ? 0 : clamp01((v - a) / (b - a));
}

/** Move a value from one range to another. */
function remap(v, inLo, inHi, outLo, outHi) {
  return lerp(outLo, outHi, unlerp(inLo, inHi, v));
}

/** Hermite ease between two edges. Flat at both ends, steepest in the middle. */
function smoothstep(edge0, edge1, v) {
  const u = unlerp(edge0, edge1, v);
  return u * u * (3 - 2 * u);
}

/**
 * The shortest way round from `from` to `to`, in radians, always in (-PI, PI].
 *
 * A TRAP, NOT A CONVENIENCE. Steering a heading needs this; getting it wrong
 * makes a mark take the long way round exactly when the angle crosses PI, which
 * is invisible on most frames and wrong on a few. Undirected marks -- a line
 * with no arrowhead, a hatch, a grain direction -- want `turn(from, to, PI)`
 * instead, because for them an angle and its opposite are the same angle.
 */
function turn(from, to, period = Math.PI * 2) {
  const half = period / 2;
  let d = (to - from) % period;
  if (d > half) d -= period;
  if (d <= -half) d += period;
  return d;
}

/** Pick from a list with a value in [0, 1). Never returns undefined. */
function pick(list, u) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('pick: needs a non-empty array');
  return list[Math.min(list.length - 1, Math.floor(clamp01(u) * list.length))];
}

/** True with probability p. */
function chance(p, u) {
  return u < p;
}

/**
 * A triangular draw in [0, 1), centred on 0.5, from TWO flat values.
 *
 * Averaging n independent uniforms shrinks the standard deviation as 1/sqrt(n).
 * Two values give a triangular distribution; additional values narrow it.
 */
function centred(u, v) {
  return (u + v) / 2;
}

module.exports = { clamp, clamp01, lerp, unlerp, remap, smoothstep, turn, pick, chance, centred };
