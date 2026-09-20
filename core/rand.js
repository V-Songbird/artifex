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
// How many (entity, property) pairs one source will remember. Past this the
// memo stops growing and every further pair takes the long way -- slower, never
// wrong. A piece that builds a fresh entity name per mark would otherwise hold
// one cache entry per mark for the life of the render.
const MEMO_MAX = 8192;

/**
 * Build the addressed source for one seed.
 *
 *   const R = rng(7);
 *   R('stroke', 'length', 12)   // always the same number for that address
 *
 * Returns a value in [0, 1). Zero is a seed.
 *
 * THE MEMO IS NOT AN OPTIMISATION OF THE VALUES, ONLY OF THE ARITHMETIC. An
 * address is hashed in two halves: the (entity, property) pair, then the index.
 * The first half is a pure function of two strings and does not depend on the
 * index at all -- and the callers that matter ask for the same pair over and
 * over. `noise2` asks four times in a row for the four corners of one lattice
 * cell; `fbm` does that once per octave; a field sampled over a grid does it
 * once per sample point.
 *
 * So the pair's hash is remembered, and what used to be two string walks plus a
 * concatenation per call becomes two map lookups. Same hash, same value, same
 * picture -- tests/rand.test.js pins the actual numbers, and would fail if this
 * were a change rather than a shortcut.
 *
 * Keyed two levels deep rather than on `entity + SEP + property`, because
 * building that key would reintroduce the allocation this exists to remove.
 */
function rng(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error(`rng: seed must be an integer in [0, 2^32-1], got ${seed}`);
  }
  const base = mix32(fnv1a('artifex', seed >>> 0));
  const memo = new Map();
  let memoSize = 0;

  return function R(entity, property, index = 0) {
    if (typeof entity !== 'string' || typeof property !== 'string') {
      throw new Error('R(entity, property, index): entity and property must be strings');
    }
    if (!Number.isInteger(index)) {
      throw new Error(`R(entity, property, index): index must be an integer, got ${index}`);
    }
    let inner = memo.get(entity);
    let h = inner === undefined ? undefined : inner.get(property);
    if (h === undefined) {
      h = fnv1a(SEP + property, fnv1a(entity, base));
      if (memoSize < MEMO_MAX) {
        if (inner === undefined) { inner = new Map(); memo.set(entity, inner); }
        inner.set(property, h);
        memoSize++;
      }
    }
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

// The gradient table for `gradient2`. Eight unit directions: the four axes and
// the four diagonals. Fixed rather than generated, and the diagonal component is
// written out as a literal instead of taken from `Math.SQRT1_2`, because this
// file promises the same number in every engine and a literal already IS that
// number. Eight is enough here: the directions only have to be spread, and a
// larger table costs a wider index for no visible gain at this lattice size.
const GRADS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071067811865476, 0.7071067811865476],
  [0.7071067811865476, -0.7071067811865476],
  [-0.7071067811865476, 0.7071067811865476],
  [-0.7071067811865476, -0.7071067811865476],
];

/** One cell's gradient, dotted with the offset from that corner to the sample. */
function gradDot(R, name, i, j, dx, dy) {
  const g = GRADS[Math.floor(R(name, 'grad', cell(i, j)) * GRADS.length)];
  return g[0] * dx + g[1] * dy;
}

/**
 * GRADIENT noise on the unit lattice -- Perlin's -- addressed like everything
 * else. In [0, 1), smooth, and a pure function of (R, x, y, name).
 *
 * WHY IT EXISTS BESIDE `noise2`. `noise2` is VALUE noise: the random number sits
 * AT the lattice point, and any fade that is flat at both ends carries it in
 * between. So across every one of its own lattice lines the field arrives flat
 * from both sides and the derivative there is zero -- measured on this machine,
 * median |d/dx| 3.8e-5 on x = integer against 3.6e-1 elsewhere, four orders
 * down. No choice of fade repairs that, because the flatness is the
 * construction. Here the random value IS a direction at the lattice point and
 * the offset to the sample is what it acts on, so the field is moving as it
 * crosses a lattice line and that line is an ordinary place to be: 3.3e-1
 * against 2.0e-1, measured the same way -- if anything STEEPER there, which is
 * what a gradient sitting at the lattice point should give. Anything that takes
 * a gradient, a curl or a hatch angle out of a field wants this one.
 *
 * The fade is Perlin's quintic, whose value and first AND second derivatives all
 * agree at both ends, so curvature is continuous across a cell boundary too and
 * a curl read off the field is smooth rather than stepped.
 *
 * The range is narrower than `noise2`'s and is deliberately not stretched to
 * fill [0, 1): with unit gradients a 2D Perlin value cannot leave +-sqrt(2)/2,
 * so scaling it to the full range would be a claim about the amplitude that is
 * not true. See docs/source-library-scan.md §8.1.
 */
function gradient2(R, x, y, name = 'field') {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const n00 = gradDot(R, name, xi, yi, fx, fy);
  const n10 = gradDot(R, name, xi + 1, yi, fx - 1, fy);
  const n01 = gradDot(R, name, xi, yi + 1, fx, fy - 1);
  const n11 = gradDot(R, name, xi + 1, yi + 1, fx - 1, fy - 1);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 0.5 + 0.5;
}

// The octave names, built once per field name and then reused.
//
// `${name}/${o}` is the same handful of strings on every call, and a field is
// sampled thousands of times per picture. Handing back the SAME string object
// each time is what lets the memo in `rng` find the pair without re-hashing the
// characters: a freshly built string carries no hash yet, an old one does.
//
// Module-level and unbounded by design: the keys are field names a piece writes
// in its source, so there are as many as the author typed.
const OCTAVE_NAMES = new Map();

function octaveNames(name, octaves) {
  let ns = OCTAVE_NAMES.get(name);
  if (ns === undefined) { ns = []; OCTAVE_NAMES.set(name, ns); }
  for (let o = ns.length; o < octaves; o++) ns.push(`${name}/${o}`);
  return ns;
}

// The frequency ratio from one octave to the next. NOT 2, and that is
// load-bearing rather than taste.
//
// With an exact doubling every octave's lattice lines land on the same
// integers, and `noise2` is value noise, whose derivative across its own
// lattice lines is zero. Four such octaves therefore agree with each other
// about where to be flat, and leave a grid of lines on which the whole field's
// gradient vanishes: measured on this machine, median |d/dx| 1.8e-4 on
// x = integer against 2.3e-1 elsewhere, a ratio of 7.9e-4. At 2.17 the octaves
// no longer share a lattice and the same measurement gives 2.8e-1 against
// 3.3e-1, a ratio of 0.83 -- an integer line stops being a special place.
// Texturing & Modeling (3rd ed., p. 88) multiplies by 2.17 for exactly this
// reason.
//
// This changes every picture that used fbm, which is why it is a decision and
// not a tidy-up. tests/rand.test.js holds the ratio open and tests/negative.js
// breaks it back to 2 on purpose. See docs/source-library-scan.md §8.1.
const LACUNARITY = 2.17;

/**
 * Summed octaves, normalised to [0, 1). Each octave is its OWN named field, so
 * the octaves are independent rather than one field read at two scales.
 *
 * Built on `noise2`. A piece that differentiates the result wants `gradient2`
 * under it instead -- see the note there.
 */
function fbm(R, x, y, octaves = 4, name = 'field') {
  const ns = octaveNames(name, octaves);
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(R, x * f, y * f, ns[o]);
    norm += amp;
    amp *= 0.5;
    f *= LACUNARITY;
  }
  return sum / norm;
}

module.exports = { rng, noise2, gradient2, fbm };
