'use strict';

// Regression checks for shared arithmetic, colour and polyline operations.

const test = require('node:test');
const assert = require('node:assert');

const { clamp, clamp01, lerp, unlerp, remap, smoothstep, turn, pick, chance, centred } = require('../core/num.js');
const { rgb, hex, mix, mixOklch, mixPigment, oklch, luma, contrast, readableOn, toLinear, toSRGB, reinhard, toneMap } = require('../core/colour.js');
const { poly, stroke, fill, outline, clipSegment, clipPolyline, boxOf } = require('../core/path.js');
const { VectorSurface } = require('../core/surface-vector.js');
const { rng } = require('../core/rand.js');

function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

const S = () => new VectorSurface({ w: 100, h: 100 });

// ---------------------------------------------------------------------------
// num
// ---------------------------------------------------------------------------

test('clamp holds a value inside its bounds, at the bounds and outside them', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp01(-0.4), 0);
  assert.equal(clamp01(1.4), 1);
  assert.equal(clamp01(0.4), 0.4);
});

test('lerp and unlerp are inverses, and remap is the two of them', () => {
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(unlerp(3, 11, lerp(3, 11, u)) - u) < 1e-12, `u=${u}`);
  }
  assert.equal(lerp(2, 9, 0), 2);
  assert.equal(lerp(2, 9, 1), 9);
  assert.equal(remap(5, 0, 10, 100, 200), 150);
  assert.equal(unlerp(4, 4, 7), 0, 'a zero-width range is 0, not NaN or Infinity');
});

test('smoothstep is flat at both edges and steepest in the middle', () => {
  assert.equal(smoothstep(0, 1, 0), 0);
  assert.equal(smoothstep(0, 1, 1), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  const d = (v) => smoothstep(0, 1, v + 0.01) - smoothstep(0, 1, v);
  assert.ok(d(0.5) > d(0.05) * 2, 'the middle must be steeper than the ends');
  assert.equal(smoothstep(0, 1, -5), 0, 'and it clamps');
  assert.equal(smoothstep(0, 1, 5), 1);
});

test('turn takes the SHORT way round, including across the wrap', () => {
  // The trap: steering a heading with a raw subtraction sends a mark the long
  // way round exactly when the angle crosses PI. Invisible on most frames.
  const T = Math.PI * 2;
  assert.ok(Math.abs(turn(3.0, -3.0) - 0.2832) < 1e-3, `got ${turn(3.0, -3.0)}`);
  assert.ok(Math.abs(turn(-3.0, 3.0) + 0.2832) < 1e-3);
  assert.equal(turn(0, 0), 0);
  assert.ok(Math.abs(turn(0.1, 0.4) - 0.3) < 1e-12, 'and the short way is just the difference when it is short');
  for (const [from, to] of [[0, 1], [1, 0], [0.1, 6.2], [6.2, 0.1], [-5, 5], [5, -5]]) {
    const d = turn(from, to);
    assert.ok(d > -Math.PI && d <= Math.PI, `${from}->${to} gave ${d}`);
    assert.ok(Math.abs(((from + d - to) % T + T) % T) < 1e-9, 'and it still arrives');
  }
});

test('turn with period PI is for marks that have no direction', () => {
  // A hatch, a grain, a line with no arrowhead: an angle and its opposite are
  // the same angle, so the short way round is at most a quarter turn.
  assert.ok(Math.abs(turn(0.1, Math.PI - 0.1, Math.PI) + 0.2) < 1e-12);
  for (let i = 0; i < 200; i++) {
    const d = turn(i * 0.31, i * 0.77, Math.PI);
    assert.ok(d > -Math.PI / 2 && d <= Math.PI / 2, `got ${d}`);
  }
});

test('pick covers the whole list and never falls off the end', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.equal(pick(list, 0), 'a');
  assert.equal(pick(list, 0.999999), 'd');
  assert.equal(pick(list, 1), 'd', 'a value of exactly 1 is the last item, not undefined');
  const seen = new Map();
  const R = rng(4);
  for (let i = 0; i < 4000; i++) {
    const v = pick(list, R('x', 'y', i));
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  assert.equal(seen.size, 4, 'every item is reachable');
  for (const [k, n] of seen) assert.ok(n > 850 && n < 1150, `${k} came up ${n} times in 4000`);
  assert.match(grab(() => pick([], 0.5)).message, /needs a non-empty array/);
});

test('chance is true at the stated rate', () => {
  const R = rng(5);
  let hits = 0;
  for (let i = 0; i < 10000; i++) if (chance(0.3, R('c', 'v', i))) hits++;
  assert.ok(Math.abs(hits / 10000 - 0.3) < 0.02, `${hits / 10000}`);
  assert.equal(chance(0, 0), false);
  assert.equal(chance(1, 0.999999), true);
});

test('centred is a TRIANGULAR draw, and two is not three', () => {
  // Averaging additional independent uniforms narrows the standard deviation
  // as 1/sqrt(n); three values must not substitute for a triangular draw.
  const R = rng(6);
  const spread = (n) => {
    let sum = 0;
    let sq = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (let k = 0; k < n; k++) v += R('d', `u${k}`, i);
      v /= n;
      sum += v; sq += v * v;
    }
    return Math.sqrt(sq / N - (sum / N) ** 2);
  };
  const two = spread(2);
  const three = spread(3);
  assert.ok(two > three * 1.15, `two uniforms spread ${two.toFixed(4)}, three only ${three.toFixed(4)}`);

  let lo = 1;
  let hi = 0;
  let sum = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const v = centred(R('t', 'a', i), R('t', 'b', i));
    assert.ok(v >= 0 && v < 1);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    sum += v;
  }
  assert.ok(Math.abs(sum / N - 0.5) < 0.01, 'centred on 0.5');
  assert.ok(lo < 0.05 && hi > 0.95, `and it still reaches the ends: ${lo.toFixed(3)}..${hi.toFixed(3)}`);
});

// ---------------------------------------------------------------------------
// colour
// ---------------------------------------------------------------------------

test('MIXING HAPPENS IN LINEAR LIGHT, which is the whole point of the module', () => {
  // A midpoint of encoded display values is darker than half the linear light.
  const half = mix('#000000', '#ffffff', 0.5);
  assert.notEqual(half, '#808080', 'a display-space average is not the colour of half the light');
  assert.equal(half, '#bcbcbc');
  assert.ok(Math.abs(luma(half) - 0.5) < 0.01, `half the light should read 0.5, got ${luma(half).toFixed(4)}`);
  assert.ok(luma('#808080') < 0.25, 'where the naive midpoint reads a stop dark');

  assert.equal(mix('#123456', '#abcdef', 0), '#123456', 'the ends are exact');
  assert.equal(mix('#123456', '#abcdef', 1), '#abcdef');
  assert.equal(mix('#123456', '#abcdef', -3), '#123456', 'and it clamps');
});

test('oklch matches the published OKLCh of the sRGB primaries', () => {
  // MDN's oklch() page gives red as oklch(0.627966 0.257704 29.2346); CSS's
  // matrices carry more digits than Ottosson's, so the fifth decimal differs.
  const near = (colour, [L, C, deg]) => {
    const [l, c, h] = oklch(colour);
    assert.ok(Math.abs(l - L) < 1e-4 && Math.abs(c - C) < 1e-4, `${colour}: L ${l}, C ${c}`);
    if (deg !== undefined) assert.ok(Math.abs(turn(h, (deg * Math.PI) / 180)) < 1e-3, `${colour}: h ${(h * 180) / Math.PI}`);
  };
  near('#ff0000', [0.627966, 0.257704, 29.2346]);
  near('#00ff00', [0.866440, 0.294827, 142.4953]);
  near('#0000ff', [0.452014, 0.313214, 264.052]);
  near('#ffffff', [1, 0]);
  near('#000000', [0, 0]);
});

test('MIXOKLCH KEEPS THE COLOUR that a linear mix loses between complements', () => {
  // Yellow to blue and pink to mint: mix goes through khaki and through grey.
  for (const [a, b] of [['#e9c46a', '#3d5a80'], ['#b56576', '#9fd8cb']]) {
    const [pa, pb, lin, ok] = [oklch(a), oklch(b), oklch(mix(a, b, 0.5)), oklch(mixOklch(a, b, 0.5))];
    const chroma = (pa[1] + pb[1]) / 2;
    assert.ok(lin[1] < chroma * 0.6, `${a}..${b}: the linear midpoint is greyed, C ${lin[1].toFixed(3)}`);
    assert.ok(Math.abs(ok[1] - chroma) < 0.005, `${a}..${b}: chroma moves evenly, C ${ok[1].toFixed(3)} of ${chroma.toFixed(3)}`);
    assert.ok(Math.abs(ok[0] - (pa[0] + pb[0]) / 2) < 0.005, `${a}..${b}: and so does lightness`);
    const half = turn(pa[2], pb[2]) / 2;
    assert.ok(Math.abs(turn(pa[2] + half, ok[2])) < 0.02, `${a}..${b}: the hue turns the short way round`);
  }
  // Black to white is the perceptual mid grey, far darker than half the light.
  assert.equal(mixOklch('#000000', '#ffffff', 0.5), '#636363');
});

test('mixOklch ends are exact, it clamps, a colour mixed with itself is itself, and alpha is mixed', () => {
  for (const [a, b] of [['#123456', '#abcdef'], ['#ffff00', '#0000ff'], ['#808080', '#ff0000'], ['#000000', '#ffffff']]) {
    assert.equal(mixOklch(a, b, 0), a);
    assert.equal(mixOklch(a, b, 1), b);
    assert.equal(mixOklch(a, b, -3), a, 'and it clamps');
    assert.equal(mixOklch(a, b, 4), b);
  }
  for (const c of ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#1a2350', '#12345680']) {
    assert.equal(mixOklch(c, c, 0.37), c, c);
  }
  assert.equal(mixOklch('#ff000080', '#0000ff', 0.5).slice(7), mix('#ff000080', '#0000ff', 0.5).slice(7), 'alpha mixes as mix does');
  assert.equal(mixOklch('#ff000080', '#0000ff', 0.5).slice(7), 'c0');
});

test('MIXPIGMENT MIXES AS PAINT: yellow and blue make green, darker than both light mixes', () => {
  const deg = (c) => (oklch(c)[2] * 180) / Math.PI;
  for (const [a, b] of [['#f2c200', '#1f4fb8'], ['#e9c46a', '#3d5a80']]) {
    const p = mixPigment(a, b, 0.5);
    assert.ok(deg(p) > 110 && deg(p) < 150, `${a}..${b}: ${p} is green, hue ${deg(p).toFixed(0)}`);
    assert.ok(oklch(p)[0] < oklch(mix(a, b, 0.5))[0] && oklch(p)[0] < oklch(mixOklch(a, b, 0.5))[0], `${a}..${b}: ${p} is darker than either light mix`);
  }
  assert.equal(mixPigment('#d8262e', '#1f4fb8', 0.5), '#58385f', 'red and blue: a dull purple');
  // Pure primaries reflect nothing in common, so all that is left is the floor.
  assert.equal(mixPigment('#ffff00', '#0000ff', 0.5), '#323232');
});

test('mixPigment ends are exact, it clamps, a colour mixed with itself is itself, and alpha is mixed', () => {
  for (const [a, b] of [['#123456', '#abcdef'], ['#ffff00', '#0000ff'], ['#000000', '#ffffff']]) {
    assert.equal(mixPigment(a, b, 0), a);
    assert.equal(mixPigment(a, b, 1), b);
    assert.equal(mixPigment(a, b, -3), a, 'and it clamps');
    assert.equal(mixPigment(a, b, 4), b);
  }
  for (const c of ['#000000', '#ffffff', '#ff0000', '#1a2350', '#12345680']) assert.equal(mixPigment(c, c, 0.37), c, c);
  assert.equal(mixPigment('#ff000080', '#0000ff', 0.5).slice(7), 'c0', 'alpha mixes as mix does');
});

test('a grey has no hue of its own in mixOklch, so it fades straight into the colour', () => {
  // Rounding gives a grey a tiny chroma at an arbitrary hue; followed, it would
  // send grey to red through orange.
  for (const grey of ['#808080', '#000000', '#ffffff', '#262626']) {
    const mid = oklch(mixOklch(grey, '#ff0000', 0.5));
    assert.ok(Math.abs(turn(mid[2], oklch('#ff0000')[2])) < 0.02, `${grey}: hue ${(mid[2] * 180) / Math.PI}`);
    const back = oklch(mixOklch('#ff0000', grey, 0.5));
    assert.ok(Math.abs(turn(back[2], oklch('#ff0000')[2])) < 0.02, `${grey}, reversed`);
  }
  assert.ok(oklch(mixOklch('#000000', '#ffffff', 0.3))[1] < 1e-3, 'and two greys stay grey');
});

test('where mixOklch leaves sRGB, chroma gives way, never lightness or hue', () => {
  // Yellow to blue turns through a green far brighter than sRGB can show.
  const [y, b] = [oklch('#ffff00'), oklch('#0000ff')];
  let reduced = 0;
  for (let i = 1; i < 10; i++) {
    const u = i / 10;
    const got = oklch(mixOklch('#ffff00', '#0000ff', u));
    const L = y[0] + (b[0] - y[0]) * u;
    const h = y[2] + turn(y[2], b[2]) * u;
    const C = y[1] + (b[1] - y[1]) * u;
    assert.ok(Math.abs(got[0] - L) < 0.005, `u=${u}: lightness ${got[0].toFixed(4)}, wanted ${L.toFixed(4)}`);
    assert.ok(Math.abs(turn(got[2], h)) < 0.02, `u=${u}: hue ${got[2].toFixed(3)}, wanted ${h.toFixed(3)}`);
    assert.ok(got[1] <= C + 0.005, `u=${u}: chroma never grows`);
    if (got[1] < C - 0.02) reduced++;
  }
  assert.ok(reduced >= 3, `the arc did leave sRGB, and chroma gave way on ${reduced} of 9 steps`);
});

test('hex parses three, four, six and eight digits, and round-trips', () => {
  assert.deepEqual(rgb('#000'), [0, 0, 0, 1]);
  assert.deepEqual(rgb('#fff'), [1, 1, 1, 1]);
  assert.deepEqual(rgb('#ffffff'), [1, 1, 1, 1]);
  assert.equal(rgb('#ff000080')[3].toFixed(3), '0.502');
  assert.equal(hex(rgb('#1a2350')), '#1a2350');
  assert.equal(hex(rgb('#1a235080')), '#1a235080');
  assert.equal(hex([0.5, 0.5, 0.5]), '#808080', 'hex does NOT encode: it is the display value you gave it');
  assert.equal(hex([2, -1, 0.5]), '#ff0080', 'and it clamps rather than emitting nonsense');
});

test('a colour that is not a colour is refused by name', () => {
  for (const bad of ['red', '#12', '#12345', 'rgb(1,2,3)', '', '#gggggg']) {
    assert.match(grab(() => rgb(bad)).message, /expected #rgb, #rrggbb or #rrggbbaa/, String(bad));
  }
});

test('sRGB encode and decode are inverses', () => {
  for (let i = 0; i <= 100; i++) {
    const v = i / 100;
    assert.ok(Math.abs(toSRGB(toLinear(v)) - v) < 1e-12, `v=${v}`);
  }
  assert.ok(toLinear(0.5) < 0.25, 'and mid grey is a quarter of the light, not half');
});

test('extended Reinhard lands white on 1 and keeps the low end nearly linear', () => {
  for (const white of [1.17, 4, 1000]) assert.ok(Math.abs(reinhard(white, white) - 1) < 1e-12, `white=${white}`);
  assert.equal(reinhard(1, Infinity), 0.5, 'and an infinite white is plain x / (1 + x)');
  assert.ok(Math.abs(reinhard(0.001, 4) / 0.001 - 1) < 0.002);
  let last = 0;
  for (let x = 0.01; x <= 4; x += 0.01) {
    const y = reinhard(x, 4);
    assert.ok(y > last, `rises at ${x}`);
    last = y;
  }
});

test('toneMap exposes from the average of lit cells and whitens at the peak, so nothing clips', () => {
  // A field spanning four decades, with the empty cells a density leaves.
  const field = new Uint32Array([0, 0, 0, 1, 2, 5, 10, 100, 1000, 10000]);
  const curve = toneMap(field);
  assert.equal(curve(10000), 1, 'the peak lands on white');
  assert.ok(curve(1000) < 1 && curve(1000) > curve(100), 'and the cells below it keep their order');
  assert.equal(curve(0), 0);
  assert.equal(curve(-1e6), 0, 'a negative value is dark, not folded round to white');
  assert.equal(curve(NaN), 0);
  // Exposure: a value at the average of the lit cells sits near key before the roll-off.
  const average = (1 + 2 + 5 + 10 + 100 + 1000 + 10000) / 7;
  assert.ok(Math.abs(curve(average) - reinhard(0.5, 10000 * 0.5 / average)) < 1e-12);
  // Adding empty cells does not move the exposure; scaling the field does not move the picture.
  const padded = toneMap(new Uint32Array([...field, 0, 0, 0, 0]));
  const scaled = toneMap(field.map((v) => v * 8));
  for (const v of field) {
    assert.equal(padded(v), curve(v));
    assert.ok(Math.abs(scaled(v * 8) - curve(v)) < 1e-12, `v=${v}`);
  }
  // A white below the peak clips above it; exposure and key brighten.
  assert.equal(toneMap(field, { white: 100 })(1000), 1);
  assert.ok(toneMap(field, { exposure: 2 })(10) > curve(10));
  assert.equal(toneMap(new Float32Array(4))(0), 0, 'an empty field is dark, not NaN');
  for (const bad of [{ key: 0 }, { exposure: -1 }, { white: NaN }, { white: Infinity }]) {
    assert.match(grab(() => toneMap(field, bad)).message, /toneMap: \w+ must be a positive finite number/);
  }
});

test('contrast is symmetric and bounded, and readableOn measures rather than assumes', () => {
  assert.ok(Math.abs(contrast('#000', '#fff') - 21) < 0.01);
  assert.equal(contrast('#123456', '#123456'), 1);
  assert.equal(contrast('#000', '#fff'), contrast('#fff', '#000'));

  assert.equal(readableOn('#101010', ['#000000', '#ffffff']), '#ffffff');
  assert.equal(readableOn('#f4f1e8', ['#000000', '#ffffff']), '#000000');
  // The case the measurement exists for: an accent light enough that paper-on-it
  // is the wrong bet, which is what a piece hard-coding one colour would do.
  assert.equal(readableOn('#d9a441', ['#f4f1e8', '#16161a']), '#16161a');
});

// ---------------------------------------------------------------------------
// path
// ---------------------------------------------------------------------------

test('poly draws the polyline every example was writing by hand', () => {
  const g = S();
  stroke(g, [[1, 1], [2, 2], [3, 1]]);
  assert.match(g.toSVG(), /d="M1 1L2 2L3 1"/);
  assert.equal(g.markCount, 1);

  const closed = S();
  stroke(closed, [[0, 0], [4, 0], [4, 4]], true);
  assert.match(closed.toSVG(), /Z"/);
});

test('a two-point run is a polyline like any other', () => {
  // The crossbar. A helper that filtered short runs would put the library back
  // where it was when a T lost its crossbar and nothing threw.
  const g = S();
  stroke(g, [[0, 0], [5, 0]]);
  assert.equal(g.markCount, 1);
  assert.match(g.toSVG(), /d="M0 0L5 0"/);
});

test('poly paints nothing by itself, because a shape and its treatment are separate', () => {
  const g = S();
  poly(g, [[0, 0], [5, 5]]);
  assert.equal(g.markCount, 0, 'no fill, no stroke, no mark');
  g.stroke();
  assert.equal(g.markCount, 1);

  const f = S();
  fill(f, [[0, 0], [5, 0], [5, 5]]);
  assert.equal(f.markCount, 1);
});

test('an empty polyline draws nothing rather than throwing', () => {
  const g = S();
  assert.doesNotThrow(() => stroke(g, []));
  assert.equal(g.markCount, 0);
});

test('clipping keeps what is inside the design box and drops what is not', () => {
  const box = boxOf({ w: 100, h: 100 });
  assert.deepEqual(box, [0, 0, 100, 100]);
  assert.deepEqual(boxOf({ w: 100, h: 100 }, 10), [10, 10, 90, 90]);

  assert.deepEqual(clipPolyline([[10, 10], [90, 90]], box), [[[10, 10], [90, 90]]], 'wholly inside, untouched');
  assert.deepEqual(clipPolyline([[200, 200], [300, 300]], box), [], 'wholly outside, gone');
  assert.deepEqual(clipPolyline([[-50, 50], [50, 50]], box), [[[0, 50], [50, 50]]], 'cut at the edge');
});

test('clipSegment returns detached endpoint pairs without changing its inputs', () => {
  const box = Object.freeze([0, 0, 10, 10]);
  for (const [start, end, expected] of [
    [[2, 3], [8, 9], [[2, 3], [8, 9]]],
    [[5, 5], [5, 5], [[5, 5], [5, 5]]],
    [[-5, 5], [15, 5], [[0, 5], [10, 5]]],
  ]) {
    const a = Object.freeze([...start]), b = Object.freeze([...end]);
    const result = clipSegment(a, b, box);
    assert.deepEqual(result, expected);
    for (const point of result) {
      assert.notStrictEqual(point, a);
      assert.notStrictEqual(point, b);
    }
    assert.notStrictEqual(result[0], result[1], 'even a zero-length segment gets independent endpoint arrays');
    result[0][0] += 1;
    result[1][1] += 1;
    assert.deepEqual(a, start);
    assert.deepEqual(b, end);
    assert.deepEqual(box, [0, 0, 10, 10]);
  }
});

test('a line that leaves the box and comes back returns as TWO runs', () => {
  // One polyline would draw a stroke straight across the picture that the piece
  // never asked for, and a plotter would draw it too.
  const box = boxOf({ w: 100, h: 100 });
  const runs = clipPolyline([[10, 50], [200, 50], [200, 80], [10, 80]], box);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0], [[10, 50], [100, 50]]);
  assert.deepEqual(runs[1], [[100, 80], [10, 80]]);

  // And the harder shape: out and straight back, with NO segment wholly
  // outside. Here the run is still live when the second piece arrives, so a
  // clipper that appends without checking the endpoints joins them silently
  // and draws a line across the picture. The first case above cannot see that.
  const vee = clipPolyline([[10, 50], [200, 50], [10, 60]], box);
  assert.equal(vee.length, 2, 'the exit and the re-entry are two marks');
  assert.deepEqual(vee[0], [[10, 50], [100, 50]]);
  assert.equal(vee[1][vee[1].length - 1][0], 10);
  assert.notDeepEqual(vee[0][vee[0].length - 1], vee[1][0], 'and they do not meet');
});

test('a segment that only grazes a corner is a pen lift, not a mark', () => {
  const box = boxOf({ w: 100, h: 100 });
  assert.deepEqual(clipPolyline([[150, 50], [50, 150]], box), []);
  assert.equal(clipSegment([150, 50], [50, 150], box)[0].join(), '100,100', 'the segment does touch');
});

test('clipping a closed shape closes it first', () => {
  const box = boxOf({ w: 100, h: 100 });
  const open = clipPolyline([[50, 50], [150, 50], [50, 150]], box, false);
  const shut = clipPolyline([[50, 50], [150, 50], [50, 150]], box, true);
  assert.ok(shut.length >= open.length, 'the closing edge can only add geometry');
  const last = shut[shut.length - 1];
  assert.deepEqual(last[last.length - 1], [50, 50], 'and the run comes home');
});

test('a clipped piece keeps its marks inside the box it declared', () => {
  const box = boxOf({ w: 200, h: 120 }, 10);
  const wild = [];
  const R = rng(9);
  for (let i = 0; i < 200; i++) wild.push([R('p', 'x', i) * 600 - 200, R('p', 'y', i) * 400 - 140]);
  for (const run of clipPolyline(wild, box)) {
    for (const [x, y] of run) {
      assert.ok(x >= box[0] - 1e-9 && x <= box[2] + 1e-9, `x=${x}`);
      assert.ok(y >= box[1] - 1e-9 && y <= box[3] + 1e-9, `y=${y}`);
    }
  }
});

// The width of an outline from `outline(..., { cap: 'butt' })` at point i of an
// n-point line with no inner folds: left side i against its right side.
const across = (out, n, i) => Math.hypot(out[i][0] - out[2 * n - 1 - i][0], out[i][1] - out[2 * n - 1 - i][1]);

// Nonzero winding number of a closed polygon around p, as canvas fills it.
function winding(p, poly) {
  let w = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]; const [bx, by] = poly[i];
    const side = (bx - ax) * (p[1] - ay) - (p[0] - ax) * (by - ay);
    if (ay <= p[1] && by > p[1] && side > 0) w++;
    else if (ay > p[1] && by <= p[1] && side < 0) w--;
  }
  return w;
}

// Distance from p to the line, and whether p lies across from some segment
// within its butt-ended band, a margin inside the half-width there; `half`
// holds the half-width at each point, straight between them.
function distanceTo(p, line, half) {
  let best = Infinity; let inBand = false;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]; const [bx, by] = line[i];
    const dx = bx - ax; const dy = by - ay;
    const raw = ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy);
    const t = Math.max(0, Math.min(1, raw));
    const d = Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy);
    best = Math.min(best, d);
    if (raw > 0 && raw < 1 && d < half[i - 1] + raw * (half[i] - half[i - 1]) - 0.05) inBand = true;
  }
  return { best, inBand };
}

// Points along an arc round (cx, cy), from angle 0 to `turn`.
const arc = (cx, cy, r, turn, count) => Array.from({ length: count }, (_, i) => {
  const a = (turn * i) / (count - 1);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

test('outline takes its width from the length along the line, not from the point count', () => {
  // Points bunched at the start: by count, the third point is two thirds along;
  // by length it is a fifth, and the width must be the width there.
  const line = [[0, 0], [10, 0], [20, 0], [100, 0]];
  const out = outline(line, (u) => 2 + 8 * u, { cap: 'butt' });
  assert.equal(out.length, 8, 'a straight butt-capped line is its two sides');
  const expected = [2, 2.8, 3.6, 10];
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(across(out, 4, i) - expected[i]) < 1e-9, `width at point ${i}: ${across(out, 4, i)}`);
  assert.deepEqual(out[1], [10, 1.4], 'the left side runs on the left normal, half the width out');

  const perPoint = outline(line, [1, 2, 3, 4], { cap: 'butt' });
  assert.ok(Math.abs(across(perPoint, 4, 2) - 3) < 1e-9, 'an array gives each point its own width');
});

test('a width of 0 at the ends tapers the outline to a point there', () => {
  const line = [];
  for (let i = 0; i <= 40; i++) line.push([i * 5, 0]);
  const swell = (u) => 48 * u * (1 - u);
  const out = outline(line, swell);
  assert.deepEqual(out, outline(line, swell, { cap: 'butt' }), 'no cap is added at a zero-width end');
  assert.deepEqual(out[0], line[0], 'the outline closes to the first point');
  assert.deepEqual(out[line.length - 1], line[line.length - 1], 'and to the last');
  const widths = line.map((_, i) => across(out, line.length, i));
  assert.ok(Math.abs(widths[20] - 12) < 1e-9, `the swell is the profile's middle: ${widths[20]}`);
  assert.ok(widths[4] < 6 && widths[36] < 6, 'and thin near the ends');
});

test('a round cap is half a circle beyond each end, at that end\'s half-width', () => {
  const out = outline([[0, 0], [50, 0]], (u) => 4 + 4 * u);
  const ends = out.filter(([x]) => x > 50 + 1e-9);
  assert.equal(ends.length, 15, 'the end cap');
  for (const [x, y] of ends) assert.ok(Math.abs(Math.hypot(x - 50, y) - 4) < 1e-9);
  assert.ok(ends.some(([x, y]) => Math.abs(x - 54) < 1e-9 && Math.abs(y) < 1e-9), 'the cap reaches straight on from the end');
  const starts = out.filter(([x]) => x < -1e-9);
  assert.equal(starts.length, 15, 'the start cap');
  for (const [x, y] of starts) assert.ok(Math.abs(Math.hypot(x, y) - 2) < 1e-9);
});

test('an outline covers its stroke at every corner, from a right angle to a reversal and a tight curl', () => {
  const h = 4;
  const lines = {
    right: [[[0, 0], [40, 0], [40, 40]], () => 2 * h],
    hairpin: [[[0, 0], [40, 0], [2, 6]], () => 2 * h],
    shortHairpin: [[[0, 0], [40, 0], [37, 2], [37, 30]], () => 2 * h],
    reversal: [[[0, 0], [40, 0], [10, 0]], () => 2 * h],
    zigzag: [[[0, 0], [10, 8], [20, 0], [30, 8], [40, 0]], () => 2 * h],
    // A curl whose radius is below the half-width: the inside of each corner
    // reaches past the centre of the curl, into the neighbouring corners.
    curl: [arc(20, 20, 6, 4.5, 31), () => 16],
    // A swell that tapers to points round a curl tighter than its middle.
    taperedCurl: [arc(20, 20, 6, 5, 61), (u) => 80 * u * (1 - u)],
    // Width that climbs and falls faster than the line turns.
    steepSwell: [arc(20, 60, 50, 1.2, 25).map(([x, y]) => [x - 30, y - 60]), (u) => 2 + 14 * Math.abs(Math.sin(9 * u))],
  };
  for (const [name, [line, width]] of Object.entries(lines)) {
    const out = outline(line, width, { cap: 'butt' });
    let total = 0;
    const half = line.map((p, i) => {
      if (i > 0) total += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
      return total;
    }).map((run) => width(run / total) / 2);
    const most = Math.max(...half);
    let holes = 0; let spill = 0;
    for (let x = -20; x <= 60; x += 0.5) {
      for (let y = -20; y <= 60; y += 0.5) {
        // Every point across from a segment is filled; how a join rounds the
        // outside of a corner is its own choice, so corner discs are not judged.
        const { best, inBand } = distanceTo([x, y], line, half);
        const covered = winding([x, y], out) !== 0;
        if (inBand && !covered) holes++;
        if (best > 4 * most + 0.05 && covered) spill++;
      }
    }
    assert.equal(holes, 0, `${name}: points inside the stroke left unfilled`);
    assert.equal(spill, 0, `${name}: fill beyond the mitre limit`);
  }
  const corner = outline(lines.right[0], () => 2 * h, { cap: 'butt' });
  assert.ok(corner.some(([x, y]) => Math.abs(x - 44) < 1e-9 && Math.abs(y + 4) < 1e-9), 'a right angle mitres outside');
  assert.ok(corner.some(([x, y]) => Math.abs(x - 36) < 1e-9 && Math.abs(y - 4) < 1e-9), 'and inside');
});

test('an outline refuses what has no direction or no width', () => {
  assert.match(grab(() => outline([[3, 3]], () => 1)).message, /two distinct points/);
  assert.match(grab(() => outline([[3, 3], [3, 3]], () => 1)).message, /two distinct points/);
  assert.match(grab(() => outline([[0, 0], [1, 0]], () => -1)).message, /not negative/);
  assert.match(grab(() => outline([[0, 0], [1, 0]], () => NaN)).message, /finite/);
  assert.match(grab(() => outline([[0, 0], [1, 0]], [1])).message, /1 widths for 2 points/);
  assert.match(grab(() => outline([[0, 0], [1, 0]], 2)).message, /function of u or an array/);
  assert.match(grab(() => outline([[0, 0], [1, 0]], () => 1, { cap: 'square' })).message, /cap must be/);
  // A repeated point is one point, and keeps the first of its widths.
  const out = outline([[0, 0], [0, 0], [10, 0]], [2, 9, 4], { cap: 'butt' });
  assert.equal(out.length, 4);
  assert.ok(Math.abs(across(out, 2, 0) - 2) < 1e-9);
});

test('an open outline is unchanged by the closed option', () => {
  // A hash of these outputs taken before `closed` existed: open lines keep
  // every point, bit for bit.
  const calls = [
    outline([[0, 0], [10, 0], [20, 0], [100, 0]], (u) => 2 + 8 * u),
    outline([[0, 0], [40, 0], [2, 6]], () => 8, { cap: 'butt' }),
    outline([[0, 0], [10, 8], [20, 0], [30, 8], [40, 0]], [1, 5, 2, 6, 3], { miterLimit: 1.5 }),
    outline(arc(20, 20, 6, 5, 61), (u) => 80 * u * (1 - u)),
    outline(arc(0, 0, 40, 2 * Math.PI, 33), (u) => 3 + Math.sin(7 * u)),
  ];
  const hash = require('node:crypto').createHash('sha256').update(JSON.stringify(calls)).digest('hex');
  assert.equal(hash, '997a65e5de33f6b7bd1a24f6bd387e0c0ba2afacf155dc636b865de7941b4ee7');
});

test('a closed outline joins round the loop with no cap, taper or seam at the start', () => {
  const loop = arc(0, 0, 40, 2 * Math.PI * (63 / 64), 64);
  const out = outline(loop, () => 6, { closed: true });
  // Constant width round a circle: every point sits on the band's edges,
  // within the mitre of a 64-gon, and no cap reaches beyond them.
  for (const [x, y] of out) {
    const off = Math.abs(Math.hypot(x, y) - 40);
    assert.ok(off > 3 - 1e-9 && off < 3.01, `a point ${off} from the line`);
  }
  assert.equal(out.length, 2 * 64 + 2,'each side once round, and the bridge between them');
  for (let k = 0; k < 64; k++) {
    const a = (2 * Math.PI * (k + 0.5)) / 64;
    assert.notEqual(winding([40 * Math.cos(a), 40 * Math.sin(a)], out), 0, `the band is filled at ${k + 0.5}`);
    assert.equal(winding([30 * Math.cos(a), 30 * Math.sin(a)], out), 0, 'and the loop is empty inside');
  }
  assert.equal(winding([0, 0], out), 0);
  assert.deepEqual(outline([...loop, loop[0]], () => 6, { closed: true }), out, 'a repeated first point is dropped');
  assert.deepEqual(outline(loop, () => 6, { closed: true, cap: 'butt' }), out, 'cap does not apply');
  assert.match(grab(() => outline([[0, 0], [5, 0], [0, 0]], () => 1, { closed: true })).message, /three distinct points/);
});

test('a closed outline takes its width periodic over the loop', () => {
  // A square of side 10: u steps a quarter round per corner and never reaches 1.
  const seen = [];
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  outline(square, (u) => { seen.push(u); return 2; }, { closed: true });
  assert.deepEqual(seen, [0, 0.25, 0.5, 0.75]);
  // A swell periodic in u: the width at the seam matches the width a whole
  // turn on, so the line meets itself at the same width.
  const loop = arc(0, 0, 40, 2 * Math.PI * (63 / 64), 64);
  const width = (u) => 4 + 3 * Math.cos(2 * Math.PI * u);
  const out = outline(loop, width, { closed: true });
  const across = (i) => Math.abs(Math.hypot(...out[i]) - Math.hypot(...out[i === 0 ? out.length - 1 : 2 * 64 + 1 - i]));
  for (const i of [0, 1, 16, 32, 63]) {
    assert.ok(Math.abs(across(i) - width(i / 64)) < 0.02, `width at point ${i}: ${across(i)} against ${width(i / 64)}`);
  }
});

test('a closed outline wider than its shape fills the middle too', () => {
  const hexagon = Array.from({ length: 6 }, (_, k) => [10 * Math.cos((k * Math.PI) / 3), 10 * Math.sin((k * Math.PI) / 3)]);
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const loops = {
    square12: [square, () => 12],
    square16: [square, () => 16],
    clockwise: [[...square].reverse(), () => 12],
    hexagon22: [hexagon, () => 22],
    swell: [arc(0, 0, 8, 2 * Math.PI * (47 / 48), 48), (u) => 10 + 8 * Math.cos(2 * Math.PI * u)],
  };
  for (const [name, [loop, width]] of Object.entries(loops)) {
    const out = outline(loop, width, { closed: true });
    const line = [...loop, loop[0]];
    let total = 0;
    const half = line.map((p, i) => {
      if (i > 0) total += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
      return total;
    }).map((run) => width(run / total) / 2);
    let holes = 0;
    for (let x = -30; x <= 40; x += 0.5) {
      for (let y = -30; y <= 40; y += 0.5) {
        if (distanceTo([x, y], line, half).inBand && winding([x, y], out) === 0) holes++;
      }
    }
    assert.equal(holes, 0, `${name}: points inside the band left unfilled`);
  }
  assert.notEqual(winding([5, 5], outline(square, () => 12, { closed: true })), 0, 'the middle of the square is filled');
});

// ---------------------------------------------------------------------------
// the contact sheet
// ---------------------------------------------------------------------------

test('the contact sheet renders reproducible seeds, not random ones', () => {
  // A contact sheet you cannot reproduce is an anecdote. The seeds are the
  // first N integers so that "seed 6 is the bad one" means something tomorrow.
  const { page } = require('../tools/contact-sheet.js');
  const html = page(['drift', 'contours'], 9, 1);

  const plans = JSON.parse(/var PLANS = (.*);/.exec(html)[1]);
  for (const cells of plans) {
    assert.deepEqual(cells.map((cell) => cell.seed), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'the seeds are counted, not rolled');
    assert.ok(cells.every((cell) => Object.keys(cell.params).length === 0), 'seed comparisons hold parameters at defaults');
  }
  assert.doesNotMatch(html, /Math\.random/, 'and nothing in the sheet is random');

  assert.match(html, /"drift","contours"/);
  assert.match(html, /var COUNT = 9;/);
  assert.match(html, /function __require/, 'the whole library is inlined, so the sheet is one file');
  assert.equal((html.match(/<script/g) || []).length, (html.match(/<\/script>/g) || []).length);

  // It renders live rather than writing SVG, which is the only way to see a
  // piece that declares raster only.
  assert.match(html, /measureFrame\(c\.getContext\('2d'\)/);
  assert.match(html, /render\.drawFrame\(surface, p, solved/);
});

test('clipPolygon cuts a ring to a box as an area to fill, where clipPolyline gives runs to stroke', () => {
  const { clipPolygon } = require('../core/path.js');
  const box = [0, 0, 10, 10], area = (ring) => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const square = [[5, 5], [15, 5], [15, 15], [5, 15]];
  const [cut] = clipPolygon(square, box);
  assert.equal(area(cut), 25, 'the quarter of the square inside the box');
  assert.ok(cut.every(([x, y]) => x >= 0 && x <= 10 && y >= 0 && y <= 10), 'every point lies in the box');
  const within = [[2, 2], [8, 2], [8, 8], [2, 8]];
  assert.deepEqual(clipPolygon(within, box), [within], 'a ring wholly inside comes back as it was');
  assert.deepEqual(clipPolygon([[20, 20], [30, 20], [30, 30]], box), [], 'a ring wholly outside gives nothing');
  // A ring that covers the box gives the box itself.
  assert.equal(area(clipPolygon([[-5, -5], [15, -5], [15, 15], [-5, 15]], box)[0]), 100);
  assert.notEqual(clipPolygon(within, box)[0][0], within[0], 'the points are copies');
  assert.throws(() => clipPolygon(within, [0, 0, 1]), /clipPolygon: box must be \[x0, y0, x1, y1\]/);
});
