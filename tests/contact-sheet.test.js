'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const {
  page, parseArgs, planSheet, planStrip, pixelBounds, measureFrame, sheetPlans, sheetStem, sheetWidth,
} = require('../tools/contact-sheet.js');
const { validate, solve } = require('../core/piece.js');
const EXAMPLES = require('../examples/index.js');
const { nullSurface } = require('../tools/bench.js');
const { load: loadStyle } = require('../tools/styles.js');
const { fakeCanvas } = require('./fake-media.js');
const stateDigest = (state) => createHash('sha256').update(JSON.stringify(state)).digest('hex');

test('contact sheet: seed-only arguments and seeds retain their existing meaning', () => {
  assert.deepEqual(parseArgs(['drift', '16', '0.5']), {
    names: ['drift'], count: 16, at: 0.5, paramNames: [], png: false, box: null, style: null,
  });
  assert.equal(parseArgs([]).count, 9);
  assert.equal(parseArgs([]).names.length, Object.keys(EXAMPLES).length);
  assert.deepEqual(planSheet(validate(EXAMPLES.drift), 3), [
    { seed: 1, params: {} }, { seed: 2, params: {} }, { seed: 3, params: {} },
  ]);
});

test('contact sheet: parameter arguments support strips and grids without consuming positional inputs', () => {
  assert.deepEqual(parseArgs(['drift', '--param', 'reach,turn']), {
    names: ['drift'], count: 3, at: 1, paramNames: ['reach', 'turn'], png: false, box: null, style: null,
  });
  assert.deepEqual(parseArgs(['--param=reach', 'drift', '5', '0.5']), {
    names: ['drift'], count: 5, at: 0.5, paramNames: ['reach'], png: false, box: null, style: null,
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
  const ctx = fakeCanvas({ width: 2, height: 2 }, nullSurface).getContext('2d');
  ctx.fillStyle = 'white';
  // Every call must reach the canvas's own context, as a native method requires.
  const operations = [];
  for (const [name, record] of [['beginPath', () => 'path'], ['fill', () => ctx.fillStyle], ['fillRect', () => ctx.fillStyle], ['clearRect', () => 'clear']]) {
    const native = ctx[name];
    ctx[name] = function (...args) { assert.equal(this, ctx); operations.push(record()); return native.apply(this, args); };
  }
  const read = ctx.getImageData;
  ctx.getImageData = function (x, y, w, h) {
    assert.equal(this, ctx);
    assert.deepEqual([x, y, w, h], [0, 0, 2, 2]);
    return read.call(this, x, y, w, h);
  };
  const metrics = measureFrame(ctx, (surface) => {
    surface.fillStyle = 'black';
    // The path fill paints no pixels here; the rectangle paints all four, and
    // clearing one leaves the bounding rectangle whole.
    surface.beginPath(); surface.fill(); surface.fillRect(0, 0, 2, 2); surface.clearRect(0, 0, 1, 1);
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

test('contact sheet: --png names the image beside the sheet, sizes it and counts the cells it waits for', () => {
  assert.equal(parseArgs(['drift', '9', '0.5', '--png']).png, true);
  assert.equal(parseArgs(['--png', 'drift', '3', '--param', 'reach,turn']).png, true, 'the option goes anywhere');
  assert.deepEqual({ ...parseArgs(['drift', '--png', '--param', 'reach']), png: undefined },
    { ...parseArgs(['drift', '--param', 'reach']), png: undefined }, 'it changes nothing else');
  const out = path.join(__dirname, '..', 'out');
  assert.equal(sheetStem(['drift'], []), path.join(out, 'drift-seeds'));
  assert.equal(sheetStem(['drift'], ['reach', 'turn']), path.join(out, 'drift-param-reach-turn'));
  assert.equal(sheetStem(Object.keys(EXAMPLES), []), path.join(out, 'seeds'));
  const external = { directory: path.join(path.sep, 'work', 'piece'), stem: 'my-piece' };
  assert.equal(sheetStem(['mine'], ['width'], external), path.join(path.sep, 'work', 'piece', 'my-piece-param-width'), 'an external piece writes beside itself');
  assert.equal(sheetWidth(9, []), 1280, 'seed sheets are 1280 CSS pixels wide');
  assert.equal(sheetWidth(3, ['reach']), 1280);
  assert.equal(sheetWidth(9, ['reach']), 48 + 9 * 220 + 8 * 14, 'a wide sweep keeps every column in the image');
  assert.deepEqual(sheetPlans(['drift'], 3, ['reach', 'turn']).map((plan) => plan.length), [9]);
  assert.deepEqual(sheetPlans(['drift', 'readout'], 4).map((plan) => plan.length), [4, 4]);
});

test('contact sheet: --box draws one piece at a box it declares, names the sheet after it, and refuses any other', () => {
  assert.deepEqual(parseArgs(['refit', '9', '1', '--box', '405x720']).box, { w: 405, h: 720 });
  assert.deepEqual({ ...parseArgs(['refit', '--box', '405x720']), box: null }, parseArgs(['refit']), 'it changes nothing else');
  for (const args of [['--box', '405x720'], ['refit', '--box'], ['refit', '--box', '405'], ['refit', '--box', '405x-7'],
    ['refit', '--box', '405x720', '--box', '720x720']]) {
    assert.throws(() => parseArgs(args), /seeds/, args.join(' '));
  }
  const out = path.join(__dirname, '..', 'out');
  assert.equal(sheetStem(['refit'], [], null, { w: 405, h: 720 }), path.join(out, 'refit-seeds-405x720'));
  assert.equal(sheetStem(['refit'], ['grain'], null, { w: 405, h: 720 }), path.join(out, 'refit-param-grain-405x720'));
  assert.throws(() => sheetPlans(['refit'], 3, [], null, { w: 100, h: 720 }), /refit cannot draw at 100 x 720/);
  assert.throws(() => sheetPlans(['drift'], 3, [], null, { w: 405, h: 720 }), /drift declares no boxes/);
  const html = page(['refit'], 2, 1, [], null, { w: 405, h: 720 });
  assert.match(html, /var BOX = \{"w":405,"h":720\};/);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
});

test('contact sheet: --style draws a style by name and names the sheet after it under out/', () => {
  assert.deepEqual(parseArgs(['--style', 'impasto', '9', '0.5']), {
    names: [], count: 9, at: 0.5, paramNames: [], png: false, box: null, style: 'impasto',
  });
  assert.equal(parseArgs(['--png', '--style', 'impasto']).count, 9);
  assert.deepEqual(parseArgs(['--style', 'impasto', '--param', 'grain']).paramNames, ['grain']);
  for (const args of [['--style'], ['--style', '--png'], ['--style', 'a', '--style', 'b'], ['--style', 'impasto', '9', '0.5', 'extra']]) {
    assert.throws(() => parseArgs(args), /seeds/, args.join(' '));
  }
  const style = loadStyle('impasto', { ARTIFEX_HOME: path.join(os.tmpdir(), 'artifex-styles-absent') });
  const out = path.join(__dirname, '..', 'out');
  assert.equal(sheetStem(style.names, [], style), path.join(out, 'style-impasto-seeds'));
  assert.equal(sheetStem(style.names, ['grain'], style), path.join(out, 'style-impasto-param-grain'));
  const html = page(style.names, 2, 1, [], style);
  assert.match(html, /var NAMES = \["impasto"\];/);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
});

test('contact sheet: --frames spreads a time strip from the first frame to the last at the piece seed, 640 px wide', () => {
  const args = parseArgs(['readout', '--frames', '9', '--png']);
  assert.deepEqual(args.strip, { frames: 9, at: null, scale: null, loupe: null });
  assert.deepEqual([args.names, args.count, args.png], [['readout'], 9, true]);
  const p = validate(EXAMPLES.readout);
  const strip = planStrip(p, args.strip);
  assert.deepEqual(strip.cells.map((cell) => cell.frame), [0, 21, 42, 63, 84, 104, 125, 146, 167]);
  assert.ok(strip.cells.every((cell) => cell.seed === p.seed && cell.t === cell.frame / 167 && cell.seconds === cell.frame / 24));
  assert.deepEqual([strip.frames, strip.hz, strip.width, strip.height, strip.columns, strip.loupe], [168, 24, 640, 427, 3, null]);
  assert.equal(planStrip(p, { frames: 3, scale: 0.25 }).width, 240, '--scale replaces the 640 px default');
  assert.equal(planStrip(p, { frames: 9, scale: 2 }).columns, 1, 'a wide cell takes a row of its own');
  assert.equal(sheetWidth(9, [], strip), 48 + 3 * 642 + 2 * 14, 'the image holds every column at one pixel per canvas pixel');
  assert.equal(sheetStem(['readout'], [], null, null, args.strip), path.join(__dirname, '..', 'out', 'readout-frames'));
  assert.deepEqual(sheetPlans(['readout'], 9, [], null, null, args.strip), [strip.cells]);
  assert.throws(() => planStrip(p, { frames: 169 }), /--frames 169 asks for more than readout's 168 frames/);
  assert.throws(() => planStrip(validate(EXAMPLES.specimen), { frames: 3 }), /specimen is a still/);
});

test('contact sheet: --at shows the frame each second falls in and refuses a second outside the film', () => {
  const p = validate(EXAMPLES.readout);
  assert.deepEqual(parseArgs(['readout', '--at', '0,0.5,6.99']).strip.at, [0, 0.5, 6.99]);
  assert.deepEqual(planStrip(p, { at: [0, 0.5, 1.99, 6.99] }).cells.map((cell) => cell.frame), [0, 12, 47, 167]);
  assert.deepEqual(planStrip({ ...validate(EXAMPLES.readout), time: { ...p.time, hz: 100 } }, { at: [0.29] }).cells.map((cell) => cell.frame), [29],
    'a second a hair under a whole frame in floating point stays in that frame');
  for (const at of [[7], [-0.01]]) assert.throws(() => planStrip(p, { at }), /is outside readout's 7 s/, String(at));
});

test('contact sheet: --loupe crops a cell of the film at 100% of its default export scale', () => {
  const p = validate(EXAMPLES.readout);
  assert.equal(parseArgs(['readout', '--frames', '3', '--loupe']).strip.loupe, true);
  assert.deepEqual(parseArgs(['readout', '--frames', '3', '--loupe', '100,50.5']).strip.loupe, { x: 100, y: 50.5 });
  assert.deepEqual(planStrip(p, { frames: 3, loupe: true }).loupe, { x: 480, y: 320, scale: 2, W: 1920, H: 1280, w: 640, h: 427, sx: 640, sy: 427 });
  assert.deepEqual(planStrip(p, { frames: 3, loupe: { x: 960, y: 640 } }).loupe, { x: 960, y: 640, scale: 2, W: 1920, H: 1280, w: 640, h: 427, sx: 1280, sy: 853 },
    'a crop at the edge stays inside the frame');
  assert.throws(() => planStrip(p, { frames: 3, loupe: { x: 961, y: 0 } }), /--loupe 961,0 is outside readout's 960 x 640 box/);
  const html = page(['readout'], 3, 1, [], null, null, { frames: 3, loupe: true });
  assert.match(html, /var STRIP = \{"frames":168,"hz":24,"scale":0\.6666666666666666,"width":640,"height":427,"columns":3,"loupe":\{/);
  assert.match(html, /result\.drawMs = /);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
});

test('contact sheet: a time strip takes one piece and --frames or --at, and --scale and --loupe need one', () => {
  for (const args of [
    ['readout', '--frames', '1'], ['readout', '--frames', '2.5'], ['readout', '--frames', '3', '--frames', '4'],
    ['readout', '--frames', '9', '--at', '1'], ['--frames', '9'], ['readout', '9', '--frames', '3'],
    ['readout', '--frames', '3', '--param', 'lead'], ['readout', '--at', '1,,2'], ['readout', '--at'],
    ['readout', '--scale', '2'], ['readout', '--loupe'], ['readout', '--frames', '3', '--scale', '0'],
  ]) assert.throws(() => parseArgs(args), /seeds/, args.join(' '));
  assert.equal(parseArgs(['--style', 'impasto', '--frames', '3']).strip.frames, 3);
  assert.equal(parseArgs(['drift', '9']).strip, undefined, 'a seed sheet is unchanged');
});
