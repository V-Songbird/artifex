'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { page, parseArgs, planSheet, pixelBounds, measureFrame } = require('../tools/contact-sheet.js');
const { validate, solve } = require('../core/piece.js');
const EXAMPLES = require('../examples/index.js');
const stateDigest = (state) => createHash('sha256').update(JSON.stringify(state)).digest('hex');

test('contact sheet: seed-only arguments and seeds retain their existing meaning', () => {
  assert.deepEqual(parseArgs(['drift', '16', '0.5']), {
    names: ['drift'], count: 16, at: 0.5, paramNames: [],
  });
  assert.equal(parseArgs([]).count, 9);
  assert.equal(parseArgs([]).names.length, Object.keys(EXAMPLES).length);
  assert.deepEqual(planSheet(validate(EXAMPLES.drift), 3), [
    { seed: 1, params: {} }, { seed: 2, params: {} }, { seed: 3, params: {} },
  ]);
});

test('contact sheet: parameter arguments support strips and grids without consuming positional inputs', () => {
  assert.deepEqual(parseArgs(['drift', '--param', 'reach,turn']), {
    names: ['drift'], count: 3, at: 1, paramNames: ['reach', 'turn'],
  });
  assert.deepEqual(parseArgs(['--param=reach', 'drift', '5', '0.5']), {
    names: ['drift'], count: 5, at: 0.5, paramNames: ['reach'],
  });
  for (const args of [
    ['--param', 'reach'], ['drift', '--param'], ['drift', '--param='],
    ['drift', '--param', 'reach,'], ['drift', '--param', 'reach,reach'],
    ['drift', '--param', 'a,b,c'], ['drift', '--param', 'reach', '--param', 'turn'],
    ['drift', '1', '--param', 'reach'], ['drift', '2.5'], ['drift', '0'],
    ['drift', '2', 'NaN'], ['drift', '--other'], ['drift', '2', '1', 'extra'],
  ]) assert.throws(() => parseArgs(args), /seeds|usage/, args.join(' '));
});

test('contact sheet: a strip includes exact endpoints and holds the piece seed and other parameters fixed', () => {
  const p = validate(EXAMPLES.drift);
  const cells = planSheet(p, 5, ['reach']);
  assert.deepEqual(cells.map((cell) => cell.params.reach), [80, 200, 320, 440, 560]);
  for (const cell of cells) {
    assert.equal(cell.seed, p.seed);
    const first = solve(p, cell.seed, cell.params);
    const second = solve(p, cell.seed, cell.params);
    assert.equal(first.stages.error, null);
    assert.equal(first.state.params.reach, cell.params.reach);
    assert.equal(stateDigest(first.state), stateDigest(second.state), 'identical inputs must reproduce build content');
    assert.equal(first.state.params.turn, p.params.turn.value);
    assert.equal(first.state.params.strokes, p.params.strokes.value);
  }
  assert.notEqual(stateDigest(solve(p, p.seed, cells[0].params).state), stateDigest(solve(p, p.seed, cells[4].params).state));
});

test('contact sheet: a grid covers the Cartesian product with the first parameter in columns', () => {
  const p = validate(EXAMPLES.drift);
  const cells = planSheet(p, 3, ['reach', 'turn']);
  assert.equal(cells.length, 9);
  assert.deepEqual(cells.map(({ params }) => [params.reach, params.turn]), [
    [80, 0.02], [320, 0.02], [560, 0.02],
    [80, 0.26], [320, 0.26], [560, 0.26],
    [80, 0.5], [320, 0.5], [560, 0.5],
  ]);
  assert.deepEqual(planSheet(p, 3, ['reach', 'turn']), cells);
  for (const params of [['missing'], ['toString'], ['reach', 'reach'], ['reach', 'turn', 'strokes']]) {
    assert.throws(() => planSheet(p, 3, params), /parameter/);
  }
  assert.throws(() => page(['constructor'], 3, 1), /no example/);
  assert.throws(() => page(['drift'], 3, 1, ['missing']), /unknown parameter/);
});

test('contact sheet: coverage measures the final pixel bounding rectangle, not occupied pixel count', () => {
  const pixels = { width: 10, height: 8, data: new Uint8ClampedArray(10 * 8 * 4) };
  assert.deepEqual(pixelBounds(pixels), { bbox: null, coverage: 0 });
  pixels.data[(2 * 10 + 3) * 4 + 3] = 1;
  pixels.data[(5 * 10 + 6) * 4 + 3] = 255;
  assert.deepEqual(pixelBounds(pixels), { bbox: { x: 3, y: 2, width: 4, height: 4 }, coverage: 0.2 });
  pixels.data[3] = 255;
  pixels.data[pixels.data.length - 1] = 255;
  assert.deepEqual(pixelBounds(pixels), { bbox: { x: 0, y: 0, width: 10, height: 8 }, coverage: 1 });
});

test('contact sheet: metrics forward native state and methods and count only successful paint calls', () => {
  const operations = [];
  const ctx = {
    canvas: { width: 2, height: 2 }, fillStyle: 'white',
    beginPath() { assert.equal(this, ctx); operations.push('path'); },
    fill() { assert.equal(this, ctx); operations.push(this.fillStyle); },
    clearRect() { assert.equal(this, ctx); operations.push('clear'); },
    getImageData(x, y, w, h) {
      assert.equal(this, ctx);
      assert.deepEqual([x, y, w, h], [0, 0, 2, 2]);
      return { width: w, height: h, data: new Uint8ClampedArray(16).fill(255) };
    },
  };
  const metrics = measureFrame(ctx, (surface) => {
    surface.fillStyle = 'black';
    surface.beginPath(); surface.fill(); surface.fill(); surface.clearRect();
    assert.equal(surface.canvas, ctx.canvas);
  });
  assert.deepEqual(operations, ['path', 'black', 'black', 'clear']);
  assert.equal(metrics.markCount, 2);
  assert.equal(metrics.coverage, 1);
  assert.throws(() => measureFrame(ctx, () => { throw new Error('draw failed'); }), /draw failed/);
});

test('contact sheet: bundled pages parse in all three modes and preserve the inspection interface', () => {
  for (const params of [[], ['reach'], ['reach', 'turn']]) {
    const html = page(['drift'], 3, 0.5, params);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
    assert.match(html, /window\.__sheet =/);
    assert.match(html, /cells: results/);
    assert.match(html, /including backgrounds/);
  }
});
