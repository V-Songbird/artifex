// The stochastic source. ADDRESSED, never sequential.
//
// WHY THERE IS NO STREAM. A sequential generator makes every value a function of
// how many values were drawn before it, so inserting one element moves every
// element after it. On a generic piece people edit constantly -- add a mark,
// delete a row, reorder a layer -- and a stream turns each of those edits into a
// new picture. `R(entity, property, index)` hashes its arguments instead, so a
// value depends on WHAT it is for and not on WHEN it was asked for.
//
// The seed enters once, through `rng(seed)`. Nothing here reads a clock, a
// counter, or anything outside its arguments, which is what makes the whole
// determinism contract hold: (seed, playhead) -> frame, forwards, backwards and
// after a scrub.
//
// Nothing here knows what kind of art a piece makes. `entity` and `property` are
// whatever the caller calls things. See docs/subject-neutrality.md.

'use strict';

const FNV_PRIME = 16777619;

/** FNV-1a over a string, continuing from `h`. */
function fnv1a(str, h) {
  h = h >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** murmur3-style finaliser. Without it, near addresses give near values. */
function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h >>> 0, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h >>> 0, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

// Separates the two halves of an address. Load-bearing: without it
// R('ab','c') and R('a','bc') are the same address, and two unrelated
// quantities in a piece move together for no reason anyone could find.
const SEP = String.fromCharCode(0);

/**
 * Build the addressed source for one seed.
 *
 *   const R = rng(7);
 *   R('stroke', 'length', 12)   // always the same number for that address
 *
 * Returns a value in [0, 1). Zero is a seed.
 */
function rng(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error(`rng: seed must be an integer in [0, 2^32-1], got ${seed}`);
  }
  const base = mix32(fnv1a('artifex', seed >>> 0));

  return function R(entity, property, index = 0) {
    if (typeof entity !== 'string' || typeof property !== 'string') {
      throw new Error('R(entity, property, index): entity and property must be strings');
    }
    if (!Number.isInteger(index)) {
      throw new Error(`R(entity, property, index): index must be an integer, got ${index}`);
    }
    let h = fnv1a(entity, base);
    h = fnv1a(SEP + property, h);
    return mix32(h ^ Math.imul(index | 0, 0x9e3779b1)) / 4294967296;
  };
}

/** Pack two lattice coordinates into one integer address. */
function cell(i, j) {
  return ((i & 0xffff) << 16) | (j & 0xffff);
}

/**
 * Value noise on the unit lattice, addressed like everything else. Smooth, in
 * [0, 1), and a pure function of (R, x, y, name).
 *
 * `name` separates one field from another: two fields sampled at the same point
 * must be independent, or every irregularity in a piece has a single cause. See
 * the five causes in skills/artifex/SKILL.md.
 */
function noise2(R, x, y, name = 'field') {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a0 = R(name, 'lattice', cell(xi, yi));
  const b0 = R(name, 'lattice', cell(xi + 1, yi));
  const a1 = R(name, 'lattice', cell(xi, yi + 1));
  const b1 = R(name, 'lattice', cell(xi + 1, yi + 1));
  return (a0 + (b0 - a0) * u) * (1 - v) + (a1 + (b1 - a1) * u) * v;
}

/**
 * Summed octaves, normalised to [0, 1). Each octave is its OWN named field, so
 * the octaves are independent rather than one field read at two scales.
 */
function fbm(R, x, y, octaves = 4, name = 'field') {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(R, x * (1 << o), y * (1 << o), `${name}/${o}`);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

module.exports = { rng, noise2, fbm, mix32, fnv1a };
