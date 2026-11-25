'use strict';

// core/medium.js: a painting medium on a grid of cells. Small sheets, so the
// file runs in seconds.

const test = require('node:test');
const assert = require('node:assert');
const { medium, pigment } = require('../core/medium.js');
const { VectorSurface } = require('../core/surface-vector.js');

const blue = pigment('#2b3a9c', { granulation: 0.8, staining: 0.2, density: 0.7 });
const rose = pigment('#c2306a', { granulation: 0.1, staining: 0.9, density: 0.2 });
const oil = pigment('#e0a21a', { opacity: 0.85 });

// The first index where two arrays differ, or -1.
function firstDiff(a, b) {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

// A wet-in-wet wash, a tilt run and body paint on one small sheet.
function sheet(seed) {
  const m = medium({ width: 120, height: 90, seed });
  m.wash([[10, 10], [110, 10], [110, 50], [10, 50]], { water: 1.2 });
  m.step(5);
  m.stroke([[15, 25], [105, 27]], { width: 18, pigment: blue, amount: 1.4 });
  m.tilt(0, 3);
  m.stroke([[20, 40], [100, 42]], { width: 12, pigment: rose, amount: 1, water: 2.2 });
  m.step(40);
  m.tilt(0, 0);
  m.dry();
  m.paint([[20, 70, 0.6], [100, 72, 1]], { colour: oil, width: 14 });
  return m.render().data;
}

test('the same seed and calls give the same sheet; another seed another paper', () => {
  const a = sheet(4);
  assert.strictEqual(firstDiff(a, sheet(4)), -1);
  assert.notStrictEqual(firstDiff(a, sheet(5)), -1);
});

test('a vector surface refuses the sheet by name', () => {
  const m = medium({ width: 40, height: 30 });
  assert.throws(() => m.draw(new VectorSurface({ w: 40, h: 30 })), /^Error: medium: a vector surface has no pixels/);
});

test('pigment mass is kept within 1e-6 through flow, settling and drying on a flat sheet', () => {
  const m = medium({ width: 120, height: 90, seed: 3 });
  m.wash([[10, 10], [110, 10], [110, 80], [10, 80]], { water: 1.2 });
  m.step(5);
  m.stroke([[15, 30], [105, 32]], { width: 20, pigment: blue, amount: 1.4 });
  m.stroke([[15, 60], [105, 58]], { width: 20, pigment: rose, amount: 1.2 });
  const before = [m.total(blue), m.total(rose)];
  m.step(60);
  m.dry();
  const after = [m.total(blue), m.total(rose)];
  for (let k = 0; k < 2; k++) {
    assert.ok(before[k] > 0, `pigment ${k} was laid down`);
    assert.ok(Math.abs(after[k] / before[k] - 1) < 1e-6, `pigment ${k}: ${before[k]} became ${after[k]}`);
  }
  assert.strictEqual(m.total(pigment('#000000')), 0);
});

test('prewet support spreads an identical initial wash without adding pigment', () => {
  const ink = pigment('#345e9c', { granulation: 0.6, staining: 0.2, density: 0.3 });
  const make = () => medium({ width: 96, height: 64, seed: 7, paper: { tooth: 0.25 } });
  const dry = make(), wet = make(), blank = dry.render({ sheen: 0 }).data;
  wet.wash([[8, 8], [88, 8], [88, 56], [8, 56]], { water: 1.2, wander: 0 });
  wet.step(8);
  const shape = [[18, 28], [78, 28], [78, 36], [18, 36]];
  for (const m of [dry, wet]) m.wash(shape, { pigment: ink, water: 0.4, amount: 0.8, wander: 0 });
  const initial = dry.render({ sheen: 0 }).data, mass = dry.total(ink);
  assert.strictEqual(wet.total(ink), mass);
  assert.strictEqual(firstDiff(initial, wet.render({ sheen: 0 }).data), -1);
  const changed = (data, i) => Math.abs(data[i] - blank[i]) + Math.abs(data[i + 1] - blank[i + 1]) + Math.abs(data[i + 2] - blank[i + 2]) >= 8;
  const spread = m => {
    m.step(24);
    assert.ok(Math.abs(m.total(ink) / mass - 1) < 1e-6);
    const data = m.render({ sheen: 0 }).data;
    let outside = 0;
    for (let i = 0; i < data.length; i += 4) if (!changed(initial, i) && changed(data, i)) outside++;
    return outside;
  };
  const drySpread = spread(dry), wetSpread = spread(wet);
  assert.ok(wetSpread > drySpread + 100, `new colored pixels: dry ${drySpread}, wet ${wetSpread}`);
});

test('new water remobilizes settled pigment after drying clears floating regions', () => {
  for (const [action, staining, initialWater = 0] of [['wash', 0.1, 0.8], ['wash + stroke', 0.1], ['stroke', 1]]) {
    const m = medium({ width: 128, height: 80, seed: 7, paper: { tooth: 0.25 } });
    const ink = pigment('#345e9c', { staining, density: 0.3, granulation: 0.6 });
    const blank = m.render({ sheen: 0, relief: 0 }).data;
    m.wash([[40, 16], [88, 16], [88, 64], [40, 64]], { pigment: ink, water: initialWater, amount: 0.9, wander: 0 });
    m.dry();
    const initial = m.render({ sheen: 0, relief: 0 }).data, mass = m.total(ink);
    if (action.includes('wash')) m.wash([[8, 8], [120, 8], [120, 72], [8, 72]], { water: 1.2, wander: 0 });
    if (action.includes('stroke')) m.stroke([[16, 40], [112, 40]], { width: 16, water: 1.2 });
    m.step(48);
    const final = m.render({ sheen: 0, relief: 0 }).data;
    const colored = (data, i) => Math.abs(data[i] - blank[i]) + Math.abs(data[i + 1] - blank[i + 1]) + Math.abs(data[i + 2] - blank[i + 2]) >= 8;
    let outside = 0;
    for (let i = 0; i < final.length; i += 4) if (!colored(initial, i) && colored(final, i)) outside++;
    assert.ok(outside > 20, `${action}, staining ${staining}: only ${outside} newly colored pixels`);
    assert.ok(Math.abs(m.total(ink) / mass - 1) < 1e-6);
  }
});

test('same-sheet watercolor coefficients mix independently of deposit order without intervening steps', () => {
  const gold = pigment('#e2bd45');
  const render = reverse => {
    const m = medium({ width: 40, height: 30, seed: 7 });
    const layers = [[blue, 0.4], [gold, 0.8]];
    if (reverse) layers.reverse();
    for (const [pg, amount] of layers) m.wash([[5, 5], [35, 5], [35, 25], [5, 25]], { pigment: pg, water: 0, amount, wander: 0 });
    return m.render().data;
  };
  assert.strictEqual(firstDiff(render(false), render(true)), -1);
});

test('feathered washes fade inward while preserving full coverage away from the edge', () => {
  // Boundaries pass through cell centres, which are at (index + 0.5) * cell.
  const shape = [[8.5, 8.5], [56.5, 8.5], [56.5, 56.5], [8.5, 56.5]];
  const make = () => medium({ width: 64, height: 64, seed: 7 });
  const hard = make(), explicit = make(), soft = make(), reversed = make();
  const options = { pigment: blue, water: 0, amount: 1, wander: 0 };
  hard.wash(shape, options);
  explicit.wash(shape, { ...options, feather: 0 });
  soft.wash(shape, { ...options, feather: 8 });
  reversed.wash([...shape, shape[0]].reverse(), { ...options, feather: 8 });
  const render = m => m.render({ relief: 0, sheen: 0 }).data;
  const a = render(hard), b = render(soft), blank = render(make());
  assert.strictEqual(firstDiff(a, render(explicit)), -1);
  assert.strictEqual(firstDiff(b, render(reversed)), -1);
  const rgbAt = (data, x, y) => Array.from(data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3));
  for (const x of [7, 8, 56]) assert.deepStrictEqual(rgbAt(b, x, 32), rgbAt(blank, x, 32));
  assert.deepStrictEqual(rgbAt(b, 32, 32), rgbAt(a, 32, 32));
  const change = x => rgbAt(b, x, 32).reduce((n, c, i) => n + Math.abs(c - rgbAt(blank, x, 32)[i]), 0);
  assert.ok(change(9) > 0 && change(9) < change(12) && change(12) < change(16));
  assert.ok(soft.total(blue) > 0 && soft.total(blue) < hard.total(blue));
});

test('feather supports concave wet washes, wander and repeated vertices deterministically', () => {
  const shape = [[12, 12], [84, 12], [84, 36], [48, 36], [48, 84], [12, 84], [12, 12]]
    .map(([x, y]) => [x + 0.75, y + 0.75]);
  const make = () => medium({ width: 96, height: 96, cell: 1.5, seed: 9 });
  const a = make(), b = make(), clean = make(), hard = make();
  const opt = { water: 0.6, wander: 0, feather: 9 };
  clean.wash(shape, opt); hard.wash(shape, { ...opt, feather: 0 });
  assert.ok(clean.wetCells() > 0 && clean.wetCells() < hard.wetCells());
  for (const m of [a, b]) {
    m.wash(shape, { ...opt, wander: 2, pigment: blue });
    const initial = m.total(blue);
    m.step(8);
    assert.ok(Math.abs(m.total(blue) / initial - 1) < 1e-6);
  }
  assert.strictEqual(firstDiff(a.render().data, b.render().data), -1);
});

test('invalid feather and overflowing edges fail before water or pigment slots change', () => {
  const m = medium({ width: 64, height: 64, cell: 2, seed: 3 });
  const shape = [[8, 8], [56, 8], [56, 56], [8, 56]], blank = m.render().data;
  for (const feather of [-1, NaN, Infinity, '2', null, Number.MIN_VALUE, 131073]) {
    assert.throws(() => m.wash(shape, { pigment: pigment('#6789ab'), feather }), /medium: feather/);
  }
  assert.throws(() => m.wash([[-1.7e308, -1.7e308], [1.7e308, 1.7e308], [0, 30]],
    { pigment: pigment('#987654'), feather: 4 }), /medium: shape/);
  assert.strictEqual(m.wetCells(), 0);
  assert.strictEqual(firstDiff(blank, m.render().data), -1);
  for (let i = 0; i < 8; i++) m.wash(shape, { pigment: pigment('#6789ab'), water: 0, feather: 4 });
});

test('maximum opacity still transmits through a thin wash and more pigment increases coverage', () => {
  const contrast = (opacity, amount) => {
    const m = medium({ width: 24, height: 16, seed: 6 });
    const ink = pigment('#345e9c', { opacity });
    m.wash([[1, 1], [23, 1], [23, 15], [1, 15]], { pigment: ink, amount, water: 0, wander: 0 });
    const background = opaqueBackdrop();
    const render = rgb => {
      for (let i = 0; i < background.data.length; i += 4) background.data.set([...rgb, 255], i);
      return m.render({ backdrop: background, sheen: 0, relief: 0 }).data;
    };
    const dark = render([31, 52, 74]), light = render([238, 229, 204]);
    const at = (8 * 24 + 12) * 4;
    return [0, 1, 2].reduce((sum, c) => sum + Math.abs(dark[at + c] - light[at + c]), 0);
  };
  assert.ok(contrast(1, 0.8) > 0, 'opacity is not an opaque alpha value');
  assert.ok(contrast(0, 0.8) > contrast(1, 0.8));
  assert.ok(contrast(1, 4) < contrast(1, 0.8));
});

test('maximum staining resists lift but does not make pigment permanently unremovable', () => {
  const removed = staining => {
    const m = medium({ width: 40, height: 30, seed: 7 }), ink = pigment('#345e9c', { staining });
    m.wash([[5, 5], [35, 5], [35, 25], [5, 25]], { pigment: ink, water: 0, amount: 0.9, wander: 0 });
    const before = m.total(ink);
    m.lift([[8, 15], [32, 15]], { width: 8, strength: 0.6 });
    return before - m.total(ink);
  };
  const strong = removed(1), weak = removed(0.1);
  assert.ok(strong > 0 && strong < weak);
});

test('paper absorption accumulates until its capacity affects standing water', () => {
  const run = absorb => {
    const m = medium({ width: 128, height: 96, seed: 7, paper: { absorb } });
    m.wash([[16, 18], [112, 18], [112, 78], [16, 78]], { pigment: blue, amount: 0.8, water: 1.2, wander: 0 });
    const mass = m.total(blue);
    m.step(96);
    assert.ok(Math.abs(m.total(blue) / mass - 1) < 1e-6);
    return { wet: m.wetCells(), pixels: m.render({ sheen: 0 }).data };
  };
  const low = run(0), high = run(1);
  assert.ok(low.wet > high.wet, `standing water: low capacity ${low.wet}, high capacity ${high.wet}`);
  assert.notStrictEqual(firstDiff(low.pixels, high.pixels), -1);
});

test('capillary water can carry pigment beyond the initial wash boundary', () => {
  const m = medium({ width: 128, height: 96, seed: 7, paper: { absorb: 1 } }), ink = pigment('#345e9c');
  m.wash([[40, 32], [88, 32], [88, 64], [40, 64]], { pigment: ink, water: 4, amount: 0.8, wander: 0 });
  const mass = m.total(ink);
  m.step(320);
  const data = m.render({ sheen: 0 }).data;
  let outside = 0;
  for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 4;
    if ((x < 40 || x >= 88 || y < 32 || y >= 64) && data[i + 2] - data[i] > 4) outside++;
  }
  assert.ok(outside > 20, `only ${outside} blue pixels reached beyond the initial boundary`);
  assert.ok(Math.abs(m.total(ink) / mass - 1) < 1e-6);
});

test('render rejects malformed light directions and preserves valid numeric vectors', () => {
  const m = glazedSheet(), before = m.render().data;
  for (const light of [null, [], [0, 0, 0], [1, 2], [1, 2, 3, 4], [NaN, 0, 1],
    [Infinity, 0, 1], ['1', 0, 1], [1, , 1], [1.7e308, 1.7e308, 1.7e308], new DataView(new ArrayBuffer(24))]) {
    assert.throws(() => m.render({ light }), /medium: light must/);
    assert.strictEqual(firstDiff(before, m.render().data), -1);
  }
  const reference = m.render({ light: [1, 2, 3] }).data;
  for (const light of [[2, 4, 6], new Float32Array([1, 2, 3]), new Float64Array([1, 2, 3])]) {
    const retained = Array.from(light);
    assert.strictEqual(firstDiff(reference, m.render({ light }).data), -1);
    assert.deepStrictEqual(Array.from(light), retained);
  }
});

test('render validates sheen on both dry and wet sheets without altering their state', () => {
  for (const wet of [false, true]) {
    const m = medium({ width: 24, height: 16, seed: 6 });
    if (wet) m.wash([[3, 3], [21, 3], [21, 13], [3, 13]], { pigment: blue, water: 1, wander: 0 });
    const before = m.render().data, mass = m.total(blue), cells = m.wetCells();
    for (const sheen of [-1, 1.1, NaN, Infinity, -Infinity, '1', null]) {
      assert.throws(() => m.render({ sheen }), /medium: sheen must be from 0 to 1/);
    }
    assert.strictEqual(firstDiff(before, m.render().data), -1);
    assert.strictEqual(m.total(blue), mass); assert.strictEqual(m.wetCells(), cells);
    assert.strictEqual(firstDiff(m.render({ sheen: 0 }).data, m.render({ sheen: 1 }).data) === -1, !wet);
  }
});

test('under a tilt a very wet stroke lets drops run downhill; flat, it does not', () => {
  // Pixels tinted blue (blue above red, which the cream paper never is) more
  // than 20 cells below the stroke's lower edge; a drip's trail is pale.
  const below = (tilt) => {
    const m = medium({ width: 120, height: 90, seed: 2 });
    m.tilt(0, tilt);
    m.stroke([[10, 20], [110, 21]], { width: 12, pigment: blue, amount: 1, water: 2.2 });
    m.step(80);
    m.tilt(0, 0);
    m.dry();
    const img = m.render().data;
    let dark = 0;
    for (let y = 47; y < 88; y++) for (let x = 0; x < 120; x++) if (img[(y * 120 + x) * 4 + 2] - img[(y * 120 + x) * 4] > 4) dark++;
    return dark;
  };
  assert.strictEqual(below(0), 0);
  assert.ok(below(3) > 5, 'no drip reached 20 cells below the stroke');
});

test('a multicoloured brush lays each pigment on its own side of the stroke', () => {
  const red = pigment('#b8261e', { opacity: 0.85 }), navy = pigment('#24409a', { opacity: 0.8 });
  const m = medium({ width: 120, height: 60, seed: 1 });
  m.paint([[10, 30], [110, 30]], { colour: [[red, 1], [navy, 1]], width: 30, multicolour: true });
  const img = m.render().data;
  // Red minus blue, summed over a row 8 cells either side of the middle.
  const lean = (y) => { let s = 0; for (let x = 30; x < 90; x++) s += img[(y * 120 + x) * 4] - img[(y * 120 + x) * 4 + 2]; return s; };
  const one = lean(22), other = lean(38);
  assert.ok(Math.sign(one) !== Math.sign(other) && Math.abs(one) > 600 && Math.abs(other) > 600, `rows lean ${one} and ${other}`);
});

test('a dirty brush lays some of the last colour; a clean one none', () => {
  const red = pigment('#b8261e', { opacity: 0.85 }), white = pigment('#f4f1ea', { opacity: 1 });
  const laid = (dirty) => {
    const m = medium({ width: 120, height: 60, seed: 1 });
    m.paint([[10, 15], [110, 15]], { colour: red, width: 16 });
    const before = m.total(red);
    m.paint([[10, 45], [110, 45]], { colour: white, width: 16, dirty });
    return m.total(red) - before;
  };
  assert.strictEqual(laid(false), 0);
  assert.ok(laid(true) > 0);
});

test('water over wet paint moves it and keeps its mass; dry paint stays', () => {
  const red = pigment('#b8261e', { opacity: 0.85 });
  const run = (curePaint) => {
    const m = medium({ width: 100, height: 80, seed: 2 });
    m.paint([[10, 30], [90, 30]], { colour: red, width: 16, load: 1.2 });
    if (curePaint) m.cure(1);
    const mass = m.total(red);
    m.tilt(0, 3);
    m.wash([[5, 15], [95, 15], [95, 50], [5, 50]], { water: 2 });
    m.step(60);
    m.tilt(0, 0);
    m.dry();
    return { after: m.render({ sheen: 0 }).data, drift: Math.abs(m.total(red) / mass - 1) };
  };
  const wetRun = run(false), dryRun = run(true);
  assert.ok(wetRun.drift < 1e-6 && dryRun.drift < 1e-6, `mass moved by ${wetRun.drift} and ${dryRun.drift}`);
  // The stroke's lower edge, 12 to 16 cells below its centre, gains red only when the paint was wet.
  const redAt = (img) => { let s = 0; for (let y = 42; y < 46; y++) for (let x = 20; x < 80; x++) s += img[(y * 100 + x) * 4] - img[(y * 100 + x) * 4 + 2]; return s; };
  assert.ok(redAt(wetRun.after) > redAt(dryRun.after) + 200, `wet ${redAt(wetRun.after)}, cured ${redAt(dryRun.after)}`);
});

test('body-paint bristle counts are bounded before pigment slots or pixels change', () => {
  const m = medium({ width: 40, height: 30 }), blank = m.render().data;
  for (const bristles of [-1, 0.5, 1.5, 97, 1e9, Infinity, -Infinity, NaN, '24', null, true]) {
    const pg = pigment('#b8261e');
    assert.throws(() => m.paint([[5, 15], [35, 15]], { colour: pg, bristles }), /medium: bristles must be/);
    assert.strictEqual(m.total(pg), 0);
    assert.strictEqual(firstDiff(blank, m.render().data), -1);
  }
  // Refused calls must not consume any of the eight pigment slots.
  for (let i = 0; i < 8; i++) {
    const pg = pigment('#345e9c');
    assert.doesNotThrow(() => m.paint([[5, 15], [35, 15]], { colour: pg, bristles: [0, 1, 96][i % 3] }));
    assert.ok(m.total(pg) > 0);
  }
});

test('levelling a new color cannot create pigment already cured on the sheet', () => {
  const red = pigment('#b8261e', { opacity: 0.85 }), cream = pigment('#f4f1df', { opacity: 0.95 });
  const m = medium({ width: 160, height: 80, cell: 0.5, seed: 7, paper: { tooth: 0.25 } });
  m.paint([[57, 12], [57, 68]], { colour: red, width: 20, load: 1.5, oil: 0.25, pick: 0, bristles: 24, length: 40 });
  m.cure(1);
  const before = m.total(red);
  m.paint([[16, 40], [144, 40]], { colour: cream, width: 15, load: 0.65, oil: 0.25, pick: 0.8, bristles: 24, length: 64 });
  const after = m.total(red);
  assert.ok(Math.abs(after / before - 1) < 1e-6, `red before ${before}, after ${after}`);
});

test('a knife redistributes wet paint but leaves fully cured paint unchanged', () => {
  const red = pigment('#b8261e', { opacity: 0.85 });
  for (const cured of [false, true]) {
    const m = medium({ width: 80, height: 40, seed: 7 });
    m.paint([[8, 20], [72, 20]], { colour: red, width: 12, load: 1.2, bristles: 24, length: 32 });
    if (cured) m.cure(1);
    const before = m.render().data, mass = m.total(red);
    m.knife([[8, 20], [72, 20]], { width: 6, level: 0.02 });
    assert.ok(Math.abs(m.total(red) / mass - 1) < 1e-6);
    assert.strictEqual(firstDiff(before, m.render().data) === -1, cured);
  }
});

test('invalid paths and paint mixtures do not consume pigment slots', () => {
  const path = [[4, 12], [28, 12]];
  const cases = [
    ['stroke', (m, p) => m.stroke([[4, 12, 2]], { pigment: p })],
    ['paint', (m, p) => m.paint([[4, 12, 2]], { colour: p })],
    ['paint', (m, p) => m.paint(path, { colour: [[p, -1]] })],
    ['paint', (m, p) => m.paint(path, { colour: [[p, 0]] })],
    ['paint', (m, p) => m.paint(path, { colour: [[p, 1], [null, 1]] })],
    ['paint', (m, p) => m.paint(path, { colour: [[p, 1], null] })],
    ['paint', (m, p) => m.paint(path, { colour: [[p, 1e308], [p, 1e308]] })],
    ['paint', m => m.paint(path, { colour: Array.from({ length: 9 }, () => [pigment('#3469ad'), 1]) })],
  ];
  for (const [kind, invalid] of cases) {
    const m = medium({ width: 32, height: 24 }), blank = m.render().data;
    for (let i = 0; i < 8; i++) assert.throws(() => invalid(m, pigment('#a93424')), /medium:/);
    assert.strictEqual(firstDiff(blank, m.render().data), -1);
    assert.strictEqual(m.wetCells(), 0);
    for (let i = 0; i < 8; i++) {
      const p = pigment('#3469ad');
      if (kind === 'stroke') m.stroke(path, { pigment: p });
      else m.paint(path, { colour: p, bristles: 8, length: 20 });
      assert.ok(m.total(p) > 0, `${kind} pigment ${i} was not registered`);
    }
  }
});

test('stationary body paint makes a reproducible dab and mixture shares are relative', () => {
  const p = pigment('#a93424'), frames = [];
  for (const path of [[[16, 12]], [[16, 12], [16, 12]], [[16, 12], [16, 12], [16, 12]]]) {
    const m = medium({ width: 32, height: 24, seed: 7 });
    m.paint(path, { colour: p, width: 12, bristles: 8, length: 20 });
    assert.ok(m.total(p) > 0);
    frames.push(m.render().data);
  }
  assert.strictEqual(firstDiff(frames[0], frames[1]), -1);
  assert.strictEqual(firstDiff(frames[0], frames[2]), -1);
  for (const colour of [[[p, 1e308]], Array.from({ length: 9 }, () => [p, 1])]) {
    const m = medium({ width: 32, height: 24, seed: 7 });
    m.paint([[16, 12]], { colour, width: 12, bristles: 8, length: 20 });
    assert.strictEqual(firstDiff(frames[0], m.render().data), -1);
  }
});

test('path and knife budgets reject excessive sampling before changing the sheet', () => {
  const m = medium({ width: 32, height: 24 }), blank = m.render().data;
  for (const tool of ['stroke', 'paint', 'knife', 'lift']) {
    for (const path of [[[0, 0], [1e100, 0]], [[0, 0], [1e100, 0], [1, 0]],
      Array(65537).fill([4, 12]), [, [4, 12]]]) {
      assert.throws(() => m[tool](path, { pigment: blue, colour: blue }), /medium:/);
      assert.strictEqual(firstDiff(blank, m.render().data), -1);
      assert.strictEqual(m.total(blue), 0);
      assert.strictEqual(m.wetCells(), 0);
    }
  }
  assert.throws(() => m.knife([[4, 12], [28, 12]], { width: 1e308 }), /medium: knife needs more/);
  assert.strictEqual(firstDiff(blank, m.render().data), -1);
  m.paint([[4, 12], [28, 12]], { colour: blue });
  assert.ok(m.total(blue) > 0);
});

test('blow validates its inputs before changing velocity and preserves zero impulses', () => {
  const run = () => {
    const m = medium({ width: 40, height: 30, seed: 7 });
    m.wash([[5, 5], [35, 5], [35, 25], [5, 25]], { pigment: blue, water: 1, wander: 0 });
    return m;
  };
  const control = run(); control.step(4);
  const expected = control.render().data, mass = control.total(blue);
  const variants = [
    [null, [1, 0], {}], [[20], [1, 0], {}], [[20, NaN], [1, 0], {}],
    [[20, 15], [Infinity, 0], {}], [[20, 15], ['1', 0], {}], [[20, 15], [1, 0, 0], {}],
    [[20, 15], [1.7e308, 1.7e308], {}],
    ...[0, -1, NaN, Infinity].map(radius => [[20, 15], [1, 0], { radius }]),
    ...[-1, NaN, Infinity, '1'].map(strength => [[20, 15], [1, 0], { strength }]),
  ];
  for (const args of variants) {
    const m = run();
    assert.throws(() => m.blow(...args), /medium:/);
    m.step(4);
    assert.strictEqual(firstDiff(expected, m.render().data), -1);
    assert.strictEqual(m.total(blue), mass);
  }
  for (const args of [[[20, 15], [0, 0], {}], [new Float32Array([20, 15]), new Float32Array([1, 0]), { strength: 0 }]]) {
    const m = run(); m.blow(...args); m.step(4);
    assert.strictEqual(firstDiff(expected, m.render().data), -1);
  }
  assert.throws(() => medium({ width: 40, height: 30, cell: 2 }).blow([20, 15], [1, 0], { radius: Number.MIN_VALUE }), /medium: blow/);
});

test('step counts are bounded and batching retains water and curing tick semantics', () => {
  const make = () => {
    const m = medium({ width: 32, height: 24, seed: 7 });
    m.wash([[4, 4], [28, 4], [28, 20], [4, 20]], { pigment: blue, wander: 0 });
    m.paint([[4, 12], [28, 12]], { colour: blue, width: 8 });
    m.cure(0, 0.2);
    return m;
  };
  const m = make(), before = m.render().data, mass = m.total(blue);
  for (const times of [-1, 0.5, 20001, 1e100, Infinity, NaN]) assert.throws(() => m.step(times), /medium: times/);
  m.step(0);
  assert.strictEqual(firstDiff(before, m.render().data), -1);
  assert.strictEqual(m.total(blue), mass);
  const batched = make(); m.step(10); batched.step(4); batched.step(6);
  assert.strictEqual(firstDiff(m.render().data, batched.render().data), -1);
  assert.strictEqual(m.total(blue), batched.total(blue));
  assert.doesNotThrow(() => medium({ width: 4, height: 4 }).step(20000));
});

test('pressure zero retains minimum contact and higher pressure broadens marks', () => {
  for (const tool of ['stroke', 'paint']) {
    const counts = [0, 0.5, 1].map(pressure => {
      const m = medium({ width: 80, height: 48, seed: 7 }), blank = m.render({ relief: 0, sheen: 0 }).data;
      m[tool]([[10, 24, pressure], [70, 24, pressure]], { pigment: blue, colour: blue,
        width: 20, water: 0, bristles: 16, length: 40, pick: 0 });
      const data = m.render({ relief: 0, sheen: 0 }).data;
      let touched = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] !== blank[i] || data[i + 1] !== blank[i + 1] || data[i + 2] !== blank[i + 2]) touched++;
      assert.ok(m.total(blue) > 0);
      return touched;
    });
    assert.ok(counts[0] > 0 && counts[0] < counts[1] && counts[1] < counts[2], `${tool}: ${counts}`);
  }
});

test('excessive finite amplitudes are rejected before changing paint or later flow', () => {
  const red = pigment('#a93424'), shape = [[3, 3], [29, 3], [29, 21], [3, 21]], path = [[4, 12], [28, 12]];
  const make = () => {
    const m = medium({ width: 32, height: 24, seed: 7 });
    m.wash(shape, { pigment: blue, water: 1, wander: 0 });
    m.paint(path, { colour: red, width: 8, bristles: 8 });
    return m;
  };
  const control = make(); control.step(2);
  const expected = control.render().data;
  for (const value of [1e6 + 1, 1e40]) for (const operation of [
    m => m.wash(shape, { pigment: blue, amount: value }),
    m => m.wash(shape, { pigment: blue, water: value }),
    m => m.stroke(path, { pigment: blue, amount: value }),
    m => m.stroke(path, { pigment: blue, water: value }),
    m => m.paint(path, { colour: red, load: value }),
    m => m.blow([16, 12], [1, 0], { strength: value }),
    m => m.tilt(value, 0), m => m.tilt(0, -value), m => m.render({ relief: value }),
  ]) {
    const m = make(), pixels = m.render().data, mass = m.total(blue), paintMass = m.total(red), wet = m.wetCells();
    assert.throws(() => operation(m), /medium:/);
    assert.strictEqual(firstDiff(pixels, m.render().data), -1);
    assert.strictEqual(m.total(blue), mass); assert.strictEqual(m.total(red), paintMass);
    assert.strictEqual(m.wetCells(), wet);
    m.step(2);
    assert.strictEqual(firstDiff(expected, m.render().data), -1);
  }
});

test('accepted amplitude ceilings keep small-sheet pigment and rendered values usable', () => {
  const shape = [[2, 2], [14, 2], [14, 10], [2, 10]], path = [[4, 6], [12, 6]];
  for (const mode of ['wash', 'stroke', 'paint', 'blow', 'tilt', 'relief', 'short release']) {
    const m = medium({ width: 16, height: 12, seed: 7 });
    if (mode === 'wash') m.wash(shape, { pigment: blue, water: 1e6, amount: 1e6, wander: 0 });
    else if (mode === 'stroke') m.stroke(path, { pigment: blue, water: 1e6, amount: 1e6, width: 4 });
    else if (['paint', 'relief', 'short release'].includes(mode)) m.paint(path, { colour: blue,
      load: mode === 'paint' ? 1e6 : 1, width: 8, bristles: 8, length: mode === 'short release' ? 1e-300 : 12 });
    else {
      m.wash(shape, { pigment: blue, water: 1, wander: 0 });
      if (mode === 'blow') m.blow([8, 6], [1, 0], { radius: 6, strength: 1e6 });
      else m.tilt(1e6, -1e6);
    }
    m.step(2);
    assert.ok(Number.isFinite(m.total(blue)) && m.total(blue) > 0, mode);
    const pixels = m.render({ relief: mode === 'relief' ? 1e6 : 1 }).data;
    let black = 0;
    for (let i = 0; i < pixels.length; i += 4) if (!pixels[i] && !pixels[i + 1] && !pixels[i + 2]) black++;
    assert.ok(black < pixels.length / 4, `${mode}: every pixel is black`);
  }
});

test('unsafe converted brush sizes, paper coordinates and release rates are refused', () => {
  const m = medium({ width: 32, height: 24, cell: 2 }), before = m.render().data;
  for (const tool of ['stroke', 'paint', 'lift']) assert.throws(() => m[tool]([[8, 12]], { width: 1e308, pigment: blue, colour: blue }), /medium: width/);
  assert.throws(() => m.wash([[4, 4], [28, 4], [28, 20]], { wander: 1e308, pigment: blue }), /medium: wander/);
  assert.throws(() => m.blow([8, 12], [1, 0], { radius: 1e308 }), /medium: blow/);
  assert.throws(() => m.stroke([[8, 12]], { pigment: blue, length: Number.MIN_VALUE }), /medium: length/);
  assert.throws(() => m.paint([[8, 12]], { colour: blue, length: Number.MIN_VALUE }), /medium: paint release rate/);
  assert.strictEqual(firstDiff(before, m.render().data), -1);
  assert.strictEqual(m.total(blue), 0); assert.strictEqual(m.wetCells(), 0);
  assert.throws(() => medium({ width: 16, height: 12, paper: { grain: Number.MIN_VALUE } }), /medium: paper.grain/);
  assert.throws(() => medium({ width: 16, height: 12, cell: 0.5, paper: { grain: Number.MAX_VALUE } }), /medium: paper.grain/);
  for (let i = 0; i < 8; i++) m.paint([[8, 12]], { colour: pigment('#345e9c') });
});

test('dry settles pending drops before remote clean water can reactivate the sheet', () => {
  for (const flattenFirst of [false, true]) {
    const m = medium({ width: 128, height: 96, seed: 2, paper: { absorb: 0 } });
    m.stroke([[64, 24]], { pigment: blue, width: 12, water: 8, amount: 2 });
    m.tilt(0, 1e-6); m.step(1);
    const mass = m.total(blue);
    if (flattenFirst) m.tilt(0, 0);
    m.dry(1e6); m.tilt(0, 0);
    const dry = m.render({ sheen: 0 }).data;
    assert.strictEqual(m.wetCells(), 0);
    m.step(1);
    assert.strictEqual(firstDiff(dry, m.render({ sheen: 0 }).data), -1);
    m.wash([[8, 72], [12, 72], [12, 76], [8, 76]], { water: 0.2, wander: 0 });
    m.step(1);
    const after = m.render({ sheen: 0 }).data;
    assert.strictEqual(firstDiff(dry.subarray(0, 128 * 64 * 4), after.subarray(0, 128 * 64 * 4)), -1);
    assert.ok(Math.abs(m.total(blue) / mass - 1) < 1e-6);
  }
});

test('a pending drop advances even after standing and absorbed grid water are gone', () => {
  const m = medium({ width: 128, height: 96, seed: 2, paper: { absorb: 0 }, evaporate: 1e6 });
  m.stroke([[64, 24]], { pigment: blue, width: 12, water: 8, amount: 2 });
  m.tilt(0, 1e-6); m.step(1);
  assert.strictEqual(m.wetCells(), 0);
  const before = m.render({ sheen: 0 }).data, mass = m.total(blue);
  m.tilt(0, 0); m.step(1);
  assert.notStrictEqual(firstDiff(before, m.render({ sheen: 0 }).data), -1);
  assert.ok(m.wetCells() > 0);
  assert.ok(Math.abs(m.total(blue) / mass - 1) < 1e-6);
});

test('the painted-layer fixture presents masks without retaining or mutating simulation state', () => {
  const { validate, solve } = require('../core/piece.js');
  const { nullSurface } = require('../tools/bench.js');
  const piece = validate(require('./fixtures/painted-layers.cjs')), result = solve(piece, 17);
  assert.strictEqual(result.stages.error, null);
  assert.strictEqual(result.state.upper, undefined); assert.strictEqual(result.state.lower, undefined);
  const snapshots = result.state.cards.map(card => new Uint8Array(card.image.data));
  const keys = Object.keys(result.state);
  for (let i = 0; i < 3; i++) piece.draw(nullSurface(piece.size), result.state);
  assert.deepStrictEqual(Object.keys(result.state), keys);
  result.state.cards.forEach((card, i) => assert.strictEqual(firstDiff(snapshots[i], card.image.data), -1));
});

test('bad options are refused by name', () => {
  assert.throws(() => pigment('#123456', { opacity: 2 }), /^RangeError: medium: opacity must be from 0 to 1, got 2$/);
  assert.throws(() => medium({ width: 1e5, height: 1e5 }), /^RangeError: medium: 100000 x 100000 cells is more than 4194304; use a larger cell$/);
  const m = medium({ width: 40, height: 30 });
  assert.throws(() => m.stroke([[0, 0], [1, 'a']]), /^TypeError: medium: path\[1\] must be \[x, y\]/);
  assert.throws(() => m.wash([[0, 0], [10, 0], [10, 10]], { pigment: {} }), /^TypeError: medium: a pigment must come from pigment\(colour, options\)$/);
});

test('lift rejects invalid widths before changing pigment, water or pixels', () => {
  for (const width of [0, -2, Infinity, -Infinity, NaN, '2', null]) {
    const m = medium({ width: 20, height: 16, seed: 4 });
    m.wash([[3, 3], [17, 3], [17, 13], [3, 13]],
      { water: 0, pigment: blue, amount: 1.4, wander: 0 });
    const mass = m.total(blue), wet = m.wetCells(), pixels = m.render().data;
    assert.throws(() => m.lift([[7, 8], [13, 8]], { width }),
      /^RangeError: medium: width must be a positive number/);
    assert.equal(m.total(blue), mass, `rejected width ${String(width)} removes no pigment`);
    assert.equal(m.wetCells(), wet, `rejected width ${String(width)} adds no water`);
    assert.equal(firstDiff(pixels, m.render().data), -1,
      `rejected width ${String(width)} changes no rendered pixel`);
  }
});

test('a valid lift removes settled pigment and wets the brush path', () => {
  const m = medium({ width: 20, height: 16, seed: 4 });
  m.wash([[3, 3], [17, 3], [17, 13], [3, 13]],
    { water: 0, pigment: blue, amount: 1.4, wander: 0 });
  const mass = m.total(blue);
  m.lift([[7, 8], [13, 8]], { width: 4 });
  assert.ok(m.total(blue) > 0 && m.total(blue) < mass, 'lifting removes only some pigment');
  assert.ok(m.wetCells() > 0 && m.wetCells() < m.cols * m.rows, 'only the brush path becomes wet');
});

function opaqueBackdrop() {
  const width = 24, height = 16, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set([50 + x * 6, 70 + y * 7, 150 + x % 2 * 40, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

function glazedSheet(colour = blue) {
  const m = medium({ width: 24, height: 16, seed: 6 });
  m.wash([[5, 4], [19, 4], [19, 12], [5, 12]], { water: 0, pigment: colour, amount: 0.6, wander: 0 });
  return m;
}

test('backdrop: an empty sheet preserves every opaque byte and returns its own buffer', () => {
  const m = medium({ width: 24, height: 16, seed: 6, paper: { tooth: 0.9, colour: '#aa3322' } });
  for (const ArrayType of [Uint8Array, Uint8ClampedArray]) {
    const backdrop = opaqueBackdrop();
    backdrop.data = new ArrayType(backdrop.data);
    const result = m.render({ backdrop, light: [1, 1, 0.1], relief: 9 });
    assert.equal(firstDiff(result.data, backdrop.data), -1);
    assert.notEqual(result.data, backdrop.data);
    const first = result.data[0];
    backdrop.data[0]++;
    assert.equal(result.data[0], first, 'the returned snapshot does not alias its input');
  }
});

test('backdrop: invalid images are refused by name', () => {
  const m = medium({ width: 24, height: 16, seed: 6 }), valid = opaqueBackdrop();
  const transparent = new Uint8Array(valid.data); transparent[3] = 254;
  for (const [input, error] of [
    [false, /backdrop must be an opaque RGBA image/],
    [{ ...valid, width: 12 }, /backdrop dimensions/],
    [{ ...valid, height: '16' }, /backdrop dimensions/],
    [{ ...valid, data: Array.from(valid.data) }, /backdrop data must be Uint8/],
    [{ ...valid, data: new Uint16Array(valid.data.length) }, /backdrop data must be Uint8/],
    [{ ...valid, data: valid.data.subarray(4) }, /backdrop data length/],
    [{ ...valid, data: transparent }, /backdrop must be opaque/],
  ]) assert.throws(() => m.render({ backdrop: input }), error);
  if (typeof SharedArrayBuffer !== 'undefined') {
    const shared = new Uint8Array(new SharedArrayBuffer(valid.data.length)); shared.set(valid.data);
    assert.throws(() => m.render({ backdrop: { ...valid, data: shared } }), /backdrop data must use unshared memory/);
  }
});

test('backdrop: clean water adds only its wet finish and dries back to the background', () => {
  const backdrop = opaqueBackdrop(), m = medium({ width: 24, height: 16, seed: 6 });
  m.wash([[5, 4], [19, 4], [19, 12], [5, 12]], { water: 0.3, wander: 0 });
  assert.equal(firstDiff(m.render({ backdrop, sheen: 0 }).data, backdrop.data), -1);
  assert.notEqual(firstDiff(m.render({ backdrop }).data, backdrop.data), -1);
  m.dry(10);
  assert.equal(firstDiff(m.render({ backdrop }).data, backdrop.data), -1);
});

test('backdrop: a glaze reads lower colors without changing the background or sheet', () => {
  const m = glazedSheet(), backdrop = opaqueBackdrop(), saved = new Uint8Array(backdrop.data);
  const before = m.render().data, mass = m.total(blue), wet = m.wetCells();
  const result = m.render({ backdrop });
  assert.notEqual(firstDiff(result.data, backdrop.data), -1, 'the glaze affects the result');
  assert.equal(firstDiff(result.data.subarray(0, 24 * 4), backdrop.data.subarray(0, 24 * 4)), -1, 'untouched row keeps exact bytes');
  const other = opaqueBackdrop();
  for (let i = 0; i < other.data.length; i += 4) other.data[i] = 255 - other.data[i];
  const changed = m.render({ backdrop: other });
  const center = (8 * 24 + 12) * 4;
  assert.notEqual(firstDiff(result.data.subarray(center, center + 3), changed.data.subarray(center, center + 3)), -1,
    'lower colors remain visible through the glaze');
  assert.equal(firstDiff(backdrop.data, saved), -1, 'input bytes are unchanged');
  assert.equal(m.total(blue), mass); assert.equal(m.wetCells(), wet);
  assert.equal(firstDiff(m.render().data, before), -1, 'backdrop is not retained in sheet state');
});

test('backdrop: body paint covers lower colors and responds to its own lighting', () => {
  const m = medium({ width: 24, height: 16, seed: 6 }), backdrop = opaqueBackdrop();
  m.paint([[4, 8], [20, 8]], { colour: oil, width: 7, load: 1.2 });
  const left = m.render({ backdrop, light: [-0.8, -0.2, 0.4], gloss: 0.6 });
  const right = m.render({ backdrop, light: [0.8, 0.2, 0.4], gloss: 0.6 });
  assert.notEqual(firstDiff(left.data, backdrop.data), -1, 'body paint is visible');
  assert.notEqual(firstDiff(left.data, right.data), -1, 'upper relief responds to lighting');
  assert.equal(firstDiff(left.data.subarray(0, 24 * 4), backdrop.data.subarray(0, 24 * 4)), -1);
});

test('backdrop: scattering layers depend on their order', () => {
  const a = glazedSheet(pigment('#bb281e', { opacity: 0.8 }));
  const b = glazedSheet(pigment('#244fa8', { opacity: 0.8 }));
  const backdrop = opaqueBackdrop();
  const ab = b.render({ backdrop: a.render({ backdrop }) });
  const ba = a.render({ backdrop: b.render({ backdrop }) });
  assert.notEqual(firstDiff(ab.data, ba.data), -1);
});

test('backdrop: omitted, undefined and null keep the default rendering path', () => {
  const m = glazedSheet();
  const expected = m.render().data;
  assert.equal(firstDiff(m.render({ backdrop: undefined }).data, expected), -1);
  assert.equal(firstDiff(m.render({ backdrop: null }).data, expected), -1);
});

// A sheet like `sheet()`, with the stroke log on or off.
function logged(log) {
  const m = medium({ width: 120, height: 90, seed: 4, log });
  m.wash([[10, 10], [110, 10], [110, 50], [10, 50]], { water: 1.2 });
  m.stroke([[15, 25], [105, 27, 0.4]], { width: 18, pigment: blue, amount: 1.4 });
  m.step(10);
  m.dry();
  m.paint([[20, 70, 0.6], [100, 72, 1]], { colour: oil, width: 14 });
  m.paint([[60, 60]], { colour: oil, width: 8 });
  return m;
}

test('stroke log: keeping it changes no pixel, and it records each stroke and paint call', () => {
  const on = logged(true);
  assert.equal(firstDiff(on.render().data, logged(false).render().data), -1);
  const calls = on.strokes();
  assert.deepStrictEqual(calls.map(c => c.kind), ['stroke', 'paint', 'paint']);
  assert.ok(Math.abs(calls[0].length - Math.hypot(90, 2)) < 1e-9);
  assert.equal(calls[0].width, 18); assert.equal(calls[0].pressureRange, 0.6);
  assert.equal(calls[2].angle, null, 'a dab has no direction');
  calls[0].width = 99;
  assert.equal(on.strokes()[0].width, 18, 'strokes() returns copies');
  const off = logged(false);
  assert.equal(off.strokes().length, 0);
  assert.equal(off.monotony().calls, 0); assert.equal(off.monotony().mean, null);
});

test('stroke log: a jittered repeat of one mark scores narrow, varied marks score wide', () => {
  const ink = pigment('#333333');
  const rep = medium({ width: 200, height: 200, cell: 4, log: true });
  const vary = medium({ width: 200, height: 200, cell: 4, log: true });
  for (let i = 0; i < 24; i++) {
    const x = 20 + (i % 6) * 30, y = 20 + Math.floor(i / 6) * 40, j = (i % 3 - 1) * 0.03;
    rep.paint([[x, y], [x + 12 * (1 + j), y + 8 * (1 - j)]], { colour: ink, width: 8 * (1 + j) });
    const a = i * 0.7, L = 6 + (i % 8) * 20;
    vary.paint([[x, y, (i % 5) / 4], [x + Math.cos(a) * L, y + Math.sin(a) * L, ((i + 2) % 5) / 4]],
      { colour: ink, width: 4 + (i % 7) * 6, oil: (i % 4) / 3, carve: (i % 6) / 5 });
  }
  const r = rep.monotony(), v = vary.monotony();
  assert.equal(r.narrowness.angle, 1); assert.ok(r.narrowness.width >= 0.7, `width ${r.narrowness.width}`);
  assert.ok(v.narrowness.angle < 0.3, `angle ${v.narrowness.angle}`);
  for (const f of ['length', 'width', 'pressure', 'oil', 'carve']) assert.ok(r.narrowness[f] > v.narrowness[f] + 0.3, `${f}: repeat ${r.narrowness[f]}, varied ${v.narrowness[f]}`);
  assert.equal(v.narrowness.load, 1, 'a setting no call changes is fully narrow');
  assert.equal(r.short, 0);
  assert.equal(r.narrowness.water, null, 'no stroke call carries water');
});
