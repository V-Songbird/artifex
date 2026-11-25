// mixSpectral: a Kubelka-Munk mix across the spectrum, and the tables it reads.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mix, mixOklch, mixPigment, mixSpectral, oklch, luma } = require('../core/colour.js');
const { derive, source } = require('./fixtures/spectral-tables.js');

const deg = (c) => ((oklch(c)[2] * 180) / Math.PI + 360) % 360;

test('the tables in core/colour.js are the ones the published methods derive', () => {
  const d = derive();
  // The Gaussian observer under the tabulated D65 lands on the D65 white point.
  for (const [got, want] of [[d.white[0], 0.9505], [d.white[1], 1], [d.white[2], 1.089]]) {
    assert.ok(Math.abs(got - want) < 1e-3, `white ${d.white.map((v) => v.toFixed(4))}`);
  }
  for (const s of d.sums) assert.ok(Math.abs(s - 1) < 1e-3, `a row sums to ${s} before scaling`);
  const text = fs.readFileSync(path.join(__dirname, '../core/colour.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const table of source(d)) {
    assert.ok(text.includes(table), `core/colour.js no longer holds ${table.slice(0, 20)}...; run node tests/fixtures/spectral-tables.js`);
  }
});

test('each primary curve stays in [0,1], the three sum to 1, and each comes back as its primary', () => {
  const { observer, primaries } = derive();
  for (let i = 0; i < 36; i++) {
    for (const p of primaries) assert.ok(p[i] >= 0 && p[i] <= 1 + 1e-9, `sample ${i}: ${p[i]}`);
    assert.ok(Math.abs(primaries[0][i] + primaries[1][i] + primaries[2][i] - 1) < 1e-9, `sample ${i} sums to 1`);
  }
  for (let p = 0; p < 3; p++) {
    for (let c = 0; c < 3; c++) {
      const back = observer[c].reduce((s, v, i) => s + v * primaries[p][i], 0);
      assert.ok(Math.abs(back - (p === c ? 1 : 0)) < 1e-9, `primary ${p}, channel ${c}: ${back}`);
    }
  }
});

test('MIXSPECTRAL MIXES AS PAINT ACROSS THE SPECTRUM: blue and yellow make a clear green', () => {
  assert.equal(mixSpectral('#002185', '#fcd200', 0.5), '#5c9440');
  assert.equal(mixSpectral('#f2c200', '#1f4fb8', 0.5), '#66983a');
  for (const [a, b] of [['#002185', '#fcd200'], ['#f2c200', '#1f4fb8'], ['#e9c46a', '#3d5a80']]) {
    const s = mixSpectral(a, b, 0.5);
    assert.ok(deg(s) > 120 && deg(s) < 150, `${a}..${b}: ${s} is green, hue ${deg(s).toFixed(0)}`);
    assert.ok(oklch(s)[1] > oklch(mixPigment(a, b, 0.5))[1], `${a}..${b}: ${s} keeps more chroma than mixPigment`);
    assert.ok(oklch(s)[0] > oklch(mixPigment(a, b, 0.5))[0], `${a}..${b}: ${s} is lighter than mixPigment`);
  }
  // Pure primaries still meet in a green, where a per-channel mix has only its floor left.
  assert.equal(mixSpectral('#ffff00', '#0000ff', 0.5), '#41795b');
  assert.equal(mixSpectral('#d8262e', '#1f4fb8', 0.5), '#593445', 'red and blue: a dull maroon');
});

test('a colour let down with white keeps its chroma, and black to white is a mid grey', () => {
  assert.equal(mixSpectral('#e02020', '#ffffff', 0.5), '#fe5f68');
  assert.ok(oklch(mixSpectral('#e02020', '#ffffff', 0.5))[1] > 3 * oklch(mix('#e02020', '#ffffff', 0.5))[1]);
  assert.equal(mixSpectral('#000000', '#ffffff', 0.5), '#707070');
  let last = -1;
  for (let i = 0; i <= 50; i++) {
    const grey = mixSpectral('#000000', '#ffffff', i / 50);
    assert.ok(oklch(grey)[1] < 1e-3, `${grey} is grey`);
    assert.ok(luma(grey) >= last, `step ${i} does not darken`);
    last = luma(grey);
  }
});

test('mixSpectral ends are exact, it clamps, a colour mixed with itself is itself, and alpha is mixed', () => {
  for (const [a, b] of [['#123456', '#abcdef'], ['#ffff00', '#0000ff'], ['#000000', '#ffffff']]) {
    assert.equal(mixSpectral(a, b, 0), a);
    assert.equal(mixSpectral(a, b, 1), b);
    assert.equal(mixSpectral(a, b, -3), a, 'and it clamps');
    assert.equal(mixSpectral(a, b, 4), b);
  }
  let off = 0;
  for (let i = 0; i < 1 << 24; i += 4099) {
    const c = `#${i.toString(16).padStart(6, '0')}`;
    if (mixSpectral(c, c, 0.37) !== c) off++;
  }
  assert.equal(off, 0, 'colours that did not come back from a mix with themselves');
  assert.equal(mixSpectral('#12345680', '#12345680', 0.37), '#12345680');
  assert.equal(mixSpectral('#ff000080', '#0000ff', 0.5).slice(7), 'c0', 'alpha mixes as mix does');
});

test('where mixSpectral leaves sRGB, chroma gives way, never the hue', () => {
  // A saturated red in white reflects more red than sRGB can show at that lightness.
  const tint = mixSpectral('#ff0000', '#ffffff', 0.5);
  assert.equal(tint, '#ff505b');
  assert.ok(Math.abs(deg(tint) - deg('#ff0000')) < 12, `hue ${deg(tint).toFixed(1)} against ${deg('#ff0000').toFixed(1)}`);
  assert.notEqual(tint, mixOklch('#ff0000', '#ffffff', 0.5));
});
