'use strict';

// Regression checks for shared arithmetic, colour and polyline operations.

const test = require('node:test');
const assert = require('node:assert');

const { clamp, clamp01, lerp, unlerp, remap, smoothstep, turn, pick, chance, centred } = require('../core/num.js');
const { rgb, hex, mix, luma, contrast, readableOn, toLinear, toSRGB } = require('../core/colour.js');
const { poly, stroke, fill, clipSegment, clipPolyline, boxOf } = require('../core/path.js');
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
