'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { rng, noise2, fbm } = require('../core/rand.js');

function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

/** Pearson correlation of two sampled series. */
function corr(n, f, g) {
  let sa = 0;
  let sb = 0;
  let sab = 0;
  let sa2 = 0;
  let sb2 = 0;
  for (let i = 0; i < n; i++) {
    const a = f(i);
    const b = g(i);
    sa += a; sb += b; sab += a * b; sa2 += a * a; sb2 += b * b;
  }
  return (n * sab - sa * sb) / Math.sqrt((n * sa2 - sa * sa) * (n * sb2 - sb * sb));
}

test('the same seed and address always give the same value', () => {
  assert.equal(rng(7)('stroke', 'length', 12), rng(7)('stroke', 'length', 12));
  assert.notEqual(rng(7)('stroke', 'length', 12), rng(8)('stroke', 'length', 12));
});

test('ONE SOURCE, ASKED TWICE, ANSWERS THE SAME', () => {
  // The test above builds a fresh source each time, so it cannot see a source
  // that remembers an answer and then hands back a different one. A source
  // carries a memo of the (entity, property) hash, and a memo is the classic
  // place for an optimisation to quietly become a change -- so the property it
  // must have is stated here rather than assumed from the fact that the numbers
  // looked right once.
  const R = rng(7);
  assert.equal(R('stroke', 'length', 12), R('stroke', 'length', 12));

  // And asking for OTHER things in between must not disturb it: a memo keyed on
  // the index, or one that overwrites its own entry, survives the two lines
  // above and dies here.
  const first = R('a', 'b');
  R('a', 'c');
  R('z', 'b');
  R('a', 'b', 5);
  assert.equal(R('a', 'b'), first, 'an address changed value after other addresses were read');

  // AND THE ORDER OF THE ASKING CANNOT MATTER, which is the deeper form of the
  // same rule and the one a memo is most likely to break. Two sources on the
  // same seed, asked for the same address after different histories, must agree
  // -- otherwise editing a piece so that one mark is drawn before another
  // changes the picture, which is the exact failure a sequential generator has
  // and the whole reason this source is addressed.
  const A = rng(7);
  const B = rng(7);
  const straight = A('form', 'twist', 0);
  B('form', 'twist', 9);
  B('form', 'other', 3);
  assert.equal(B('form', 'twist', 0), straight,
    'an address answered differently because something else was asked first');
});

test('zero is a seed', () => {
  const a = rng(0)('x', 'y');
  assert.ok(Number.isFinite(a) && a >= 0 && a < 1);
  assert.notEqual(a, rng(1)('x', 'y'));
});

test('a seed outside [0, 2^32-1] is refused by name', () => {
  for (const bad of [-1, 1.5, NaN, 2 ** 32, '3']) {
    assert.match(grab(() => rng(bad)).message, /seed must be an integer in \[0, 2\^32-1\]/);
  }
});

test('an address that is not (string, string, integer) is refused by name', () => {
  const R = rng(1);
  assert.match(grab(() => R(1, 'a')).message, /entity and property must be strings/);
  assert.match(grab(() => R('a', 2)).message, /entity and property must be strings/);
  assert.match(grab(() => R('a', 'b', 1.5)).message, /index must be an integer/);
});

test('the two halves of an address do not run together', () => {
  // Without a separator R('ab','c') and R('a','bc') are the same address, and
  // two unrelated quantities in a piece move together for no findable reason.
  const R = rng(3);
  assert.notEqual(R('ab', 'c'), R('a', 'bc'));
  assert.notEqual(R('stroke', 'width'), R('strokewid', 'th'));
});

test('ADDRESSED, NOT SEQUENTIAL: asking for one value does not move another', () => {
  // The property the whole design rests on. On a stream, drawing 0..4 first
  // changes what 5 returns, so inserting an element repaints the picture.
  const a = rng(5)('mark', 'angle', 5);
  const R = rng(5);
  for (let i = 0; i < 5; i++) R('mark', 'angle', i);
  R('something', 'else', 99);
  assert.equal(R('mark', 'angle', 5), a);
});

test('values are spread over [0, 1)', () => {
  const R = rng(9);
  const N = 50000;
  const bins = new Array(10).fill(0);
  let lo = 1;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const v = R('u', 'v', i);
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    bins[Math.floor(v * 10)]++;
    sum += v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  for (const [i, b] of bins.entries()) {
    const pct = (b / N) * 100;
    assert.ok(pct > 9 && pct < 11, `decile ${i} holds ${pct.toFixed(2)}%`);
  }
  assert.ok(Math.abs(sum / N - 0.5) < 0.01, `mean ${(sum / N).toFixed(4)}`);
  // Paired with the spread: a generator that returned 0.5 forever would pass a
  // mean test. The ends have to be reached too.
  assert.ok(lo < 0.001 && hi > 0.999, `range ${lo} .. ${hi}`);
});

test('near addresses do not give near values', () => {
  // Without the finaliser, consecutive indices walk slowly and every "random"
  // sequence in a piece becomes a ramp. Measured as a CORRELATION rather than
  // as a count under a tolerance: the fault's own structure decides the check.
  // A dropped finaliser leaves neighbouring indices strongly correlated; an
  // intact one leaves them at zero, and there is nothing to tune in between.
  const R = rng(4);
  const r = corr(2000, (i) => R('a', 'b', i), (i) => R('a', 'b', i + 1));
  assert.ok(Math.abs(r) < 0.1, `consecutive indices correlate at r = ${r.toFixed(4)}`);
});

test('noise2 is smooth, and in range', () => {
  const R = rng(2);
  for (let i = 0; i < 400; i++) {
    const x = i * 0.37;
    const y = i * 0.11;
    const a = noise2(R, x, y);
    assert.ok(a >= 0 && a < 1, `out of range: ${a}`);
    assert.ok(Math.abs(noise2(R, x + 0.002, y) - a) < 0.02, 'a small step gives a small change');
  }
});

test('noise2 actually varies, so a flat field cannot pass', () => {
  const R = rng(2);
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < 600; i++) {
    const v = noise2(R, i * 0.31, i * 0.79);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  assert.ok(hi - lo > 0.5, `range was only ${(hi - lo).toFixed(3)}`);
});

test('two named fields are independent at the same point', () => {
  // Otherwise every irregularity in a piece has one cause, and the piece reads
  // as one algorithm however many places it is sampled.
  //
  // The check is a correlation, not a tolerance, because the failure has a
  // shape: if the name were ignored the two fields would be the SAME field, so
  // r would be exactly 1. Measured: named fields sit at r = -0.02, and the same
  // name at r = 1.0000. There is no tuning between those two numbers.
  const R = rng(6);
  const r = corr(2000, (i) => noise2(R, i * 0.53, i * 0.29, 'flow'),
    (i) => noise2(R, i * 0.53, i * 0.29, 'grain'));
  assert.ok(Math.abs(r) < 0.1, `two named fields correlate at r = ${r.toFixed(4)}`);
  assert.equal(corr(400, (i) => noise2(R, i * 0.53, i * 0.29, 'flow'),
    (i) => noise2(R, i * 0.53, i * 0.29, 'flow')).toFixed(3), '1.000', 'and the same name is the same field');
});

test('fbm stays in range and is a pure function of its arguments', () => {
  const R = rng(8);
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < 2000; i++) {
    const v = fbm(R, i * 0.013, i * 0.029, 4);
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  assert.ok(hi - lo > 0.4, `range was only ${(hi - lo).toFixed(3)}`);
  assert.equal(fbm(R, 1.5, 2.5, 4), fbm(rng(8), 1.5, 2.5, 4));
});

test('fbm octaves are separate fields, not one field read at two scales', () => {
  // Stated at the octaves themselves. Comparing 1 octave against 4 would NOT
  // test this: the base octave carries over half the sum, so those correlate at
  // about r = 0.86 in a perfectly correct fBm. The property is that octave o
  // and octave o+1 are different fields at the same point -- and if the octave
  // suffix were dropped from the field name they would be identical.
  const R = rng(10);
  const at = (o) => (i) => noise2(R, i * 0.41 * (1 << o), i * 0.17 * (1 << o), `f/${o}`);
  const same = (o) => (i) => noise2(R, i * 0.41, i * 0.17, `f/${o}`);
  const r = corr(2000, same(0), same(1));
  assert.ok(Math.abs(r) < 0.1, `octave 0 and octave 1 correlate at r = ${r.toFixed(4)}`);
  assert.ok(Math.abs(corr(2000, at(0), at(2))) < 0.2, 'and so do octaves two apart');

  // And fbm must actually USE those separate names. One octave of fbm is the
  // field NAMED FOR THAT OCTAVE, never the bare field -- if the suffix were
  // dropped, every octave would be one field read at four scales.
  assert.equal(fbm(R, 1.3, 2.7, 1, 'a'), noise2(R, 1.3, 2.7, 'a/0'));
  assert.notEqual(fbm(R, 1.3, 2.7, 1, 'a'), noise2(R, 1.3, 2.7, 'a'));

  // TWO octaves, because ONE CANNOT SEE THE SECOND NAME AT ALL. This test used
  // to stop at the line above, and a mutation that names every octave `a/0`
  // walked straight through it: octave zero was still right, and octave zero was
  // all the test ever looked at. The fix is not a wider tolerance, it is the
  // octave the fault lives in. Frequency doubles and amplitude halves, both
  // pinned here, so the octave names and the octave scales stand or fall
  // together.
  const two = fbm(R, 1.3, 2.7, 2, 'a');
  const byHand = (noise2(R, 1.3, 2.7, 'a/0') + 0.5 * noise2(R, 2.6, 5.4, 'a/1')) / 1.5;
  assert.ok(Math.abs(two - byHand) < 1e-12,
    `two octaves gave ${two}, and the two named fields give ${byHand}`);
});
