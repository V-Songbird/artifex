'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  page, parseArgs, printData, photoCrop, cropReference, measureSound, soundProfile, soundStems, shotGaps, silentSpans, SOUND_HELPERS, cellViews, styleStats, styleGap, styleText, frameGap, frameText, FRAME_THRESHOLD, FRAME_GRID, planSheet, sweepLabels, planStrip, pixelBounds, measureFrame, frameDetail, gridChange, stripFlags, trustedCell, STRIP_RULES,
  main, sheetPlans, sheetStem, sheetWidth, drawsInPage, refuseSheet, soundPicture, soundSummary, beatSummary, shotList, USAGE,
  contactList, CONTACT_WINDOW, MAX_CONTACTS, recordMarks, paintOrder, layerSwaps, partCover, figureFill, silhouette, PAINT, armatureList, jointFaults, armatureText, ARMATURE_RULES,
  viewPlan, planText, planPage, cutPlan, cutOverlay, strayEdge, massShare, litArea, CUT_RULES, declaredValues, levelText, failureText,
} = require('../tools/contact-sheet.js');
const { styleCause } = require('../tools/styles.js');
const { playheads, drawFrame } = require('../core/render.js');
const { loadExternal, inLibrary } = require('../tools/piece-input.js');
const { validate, solve, atBox } = require('../core/piece.js');
const { pose } = require('../core/armature.js');
const EXAMPLES = require('../examples/index.js');
const { nullSurface } = require('../tools/bench.js');
const { fakeCanvas, fakeAudio } = require('./fake-media.js');
const stateDigest = (state) => createHash('sha256').update(JSON.stringify(state)).digest('hex');
// Synthetic characterization data in the layout of Fogra's FOGRA39L.txt, which Artifex does not ship: the patches
// the print-gamut view reads from it.
const PRINT_FILE = path.join(__dirname, 'fixtures', 'print-characterization-synthetic.txt');
const PRINT = printData(fs.readFileSync(PRINT_FILE, 'utf8'), PRINT_FILE);

test('contact sheet: seed-only arguments and seeds retain their existing meaning', () => {
  assert.deepEqual(parseArgs(['drift', '16', '0.5']), {
    names: ['drift'], count: 16, at: 0.5, paramNames: [], png: false, json: false, box: null,
  });
  assert.equal(parseArgs([]).count, 9);
  assert.equal(parseArgs([]).names.length, Object.keys(EXAMPLES).length);
  assert.deepEqual(planSheet(validate(EXAMPLES.drift), 3), [
    { seed: 1, params: {} }, { seed: 2, params: {} }, { seed: 3, params: {} },
  ]);
});

test('contact sheet: parameter arguments support strips and grids without consuming positional inputs', () => {
  assert.deepEqual(parseArgs(['drift', '--param', 'reach,turn']), {
    names: ['drift'], count: 3, at: 1, paramNames: ['reach', 'turn'], png: false, json: false, box: null,
  });
  assert.deepEqual(parseArgs(['--param=reach', 'drift', '5', '0.5']), {
    names: ['drift'], count: 5, at: 0.5, paramNames: ['reach'], png: false, json: false, box: null,
  });
  for (const args of [
    ['--param', 'reach'], ['drift', '--param'], ['drift', '--param='],
    ['drift', '--param', 'reach,'], ['drift', '--param', 'reach,reach'],
    ['drift', '--param', 'a,b,c'], ['drift', '--param', 'reach', '--param', 'turn'],
    ['drift', '1', '--param', 'reach'], ['drift', '2.5'], ['drift', '0'],
    ['drift', '2', 'NaN'], ['drift', '--other'], ['drift', '2', '1', 'extra'],
  ]) assert.throws(() => parseArgs(args), /seeds|usage/, args.join(' '));
});

test('contact sheet: --param with --seeds draws one row per seed, and a malformed list is refused', async (t) => {
  const args = parseArgs(['drift', '4', '--param', 'reach', '--seeds', '1,2,3']);
  assert.deepEqual(args.seeds, [1, 2, 3]);
  assert.deepEqual(parseArgs(['drift', '--param', 'reach', '--seeds', '0,4294967295']).seeds, [0, 4294967295]);
  assert.equal('seeds' in parseArgs(['drift', '--param', 'reach']), false, 'without --seeds the args are unchanged');
  const p = validate(EXAMPLES.drift);
  const cells = planSheet(p, 4, ['reach'], args.seeds);
  assert.equal(cells.length, 12, 'three rows of four');
  assert.deepEqual(cells.map((cell) => cell.seed), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  assert.deepEqual(cells.map((cell) => cell.params.reach), [80, 240, 400, 560, 80, 240, 400, 560, 80, 240, 400, 560]);
  assert.deepEqual(planSheet(p, 4, ['reach']).map((cell) => cell.seed), [p.seed, p.seed, p.seed, p.seed], 'without seeds a sweep holds the piece\'s own seed');
  const html = page(['drift'], 4, 1, ['reach'], null, null, null, null, args.seeds);
  const labels = JSON.parse(/var LABELS = (.*);/.exec(html)[1])[0];
  assert.equal(labels.length, 12);
  assert.equal(labels[0], 'seed 1 · reach=80');
  assert.equal(labels[7], 'seed 2 · reach=560');
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
  assert.notEqual(sheetStem(['drift'], ['reach'], null, null, null, [1, 2, 3]), sheetStem(['drift'], ['reach']), 'a sweep at seeds keeps its own file');
  assert.notEqual(sheetStem(['drift'], ['reach'], null, null, null, [1, 2, 3]), sheetStem(['drift'], ['reach'], null, null, null, [1, 2]));
  const refusals = [
    [['drift', '--param', 'reach', '--seeds'], /--seeds needs distinct whole numbers .* got nothing/],
    [['drift', '--param', 'reach', '--seeds', '1,,2'], /--seeds needs distinct whole numbers .* got 1,,2/],
    [['drift', '--param', 'reach', '--seeds', '1,x'], /--seeds needs distinct whole numbers/],
    [['drift', '--param', 'reach', '--seeds', '-1,2'], /--seeds needs distinct whole numbers/],
    [['drift', '--param', 'reach', '--seeds', '1.5'], /--seeds needs distinct whole numbers/],
    [['drift', '--param', 'reach', '--seeds', '4294967296'], /--seeds needs distinct whole numbers/],
    [['drift', '--param', 'reach', '--seeds', '1,2,1'], /--seeds needs distinct whole numbers/],
    [['drift', '--param', 'reach', '--seeds', '1,2', '--seeds', '3'], /use --seeds only once/],
    [['drift', '--seeds', '1,2'], /--seeds draws one row per seed of a parameter sweep; give --param one name/],
    [['drift', '--param', 'reach,turn', '--seeds', '1,2'], /give --param one name/],
    [['drift', '--frames', '3', '--seeds', '1,2'], /a time strip draws at one seed, set with --seed; drop --seeds/],
    [['drift', '--param', 'reach', '--seeds', '1,2', '--seed', '3'], /a sweep takes --seed or --seeds, not both/],
    [['drift', '--param', 'reach,turn', '--seed', '3'], /a sweep of two names holds the piece's own seed, so drop --seed or give --param one name/],
    [['drift', '--seed', '3'], /a contact sheet already sweeps seeds 1 to its count/],
    [['drift', '--param', 'reach', '--seed', '1.5'], /--seed takes a whole number from 0 to 4294967295, got 1.5/],
    [['drift', '--param', 'reach', '--seed', '1', '--seed', '2'], /use --seed only once/],
    [['drift', '--param', 'reach', '--seeds', Array.from({ length: 17 }, (_, i) => i).join(',')], /--seeds draws one row per seed, up to 16, got 17/],
  ];
  assert.deepEqual(parseArgs(['drift', '--param', 'reach', '--seed', '7']).seeds, [7], 'one --seed is a one-row sweep');
  assert.equal(parseArgs(['drift', '--param', 'reach', '--seeds', Array.from({ length: 16 }, (_, i) => i).join(',')]).seeds.length, 16);
  for (const [bad, message] of refusals) {
    await t.test(bad.join(' '), () => assert.throws(() => parseArgs(bad), (e) => message.test(e.message) && e.message.startsWith('seeds: ') && e.message.endsWith(USAGE)));
  }
  let fromCommandLine, fromPlan;
  try { parseArgs(['drift', '--param', 'reach,turn', '--seeds', '1,2']); } catch (e) { fromCommandLine = e.message; }
  try { planSheet(p, 4, ['reach', 'turn'], [1, 2]); } catch (e) { fromPlan = e.message; }
  assert.ok(fromCommandLine && fromCommandLine.includes('--seeds draws one row per seed'), 'the command line refuses');
  assert.equal(fromPlan, fromCommandLine, 'planSheet refuses --seeds with two names in the same words as the command line');
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

test('contact sheet: a whole-number span samples exact whole values, so a piece that floors a knob draws each once', () => {
  const sweep = (min, max, count) => planSheet({ seed: 1, params: { k: { min, max } } }, count, ['k']).map((cell) => cell.params.k);
  assert.equal(sweep(0, 22, 23)[15], 15);
  assert.equal(sweep(2, 8, 4)[2], 6);
  assert.equal(sweep(1, 6, 6)[2], 3);
  // (max - min) * (count - 1) is 8.97e15, just under 2^53, where the lerp gives 231199979298364.97.
  assert.equal(sweep(-17999999999995, 1477199875790165, 7)[1], 231199979298365, 'a large span inside the 2^53 bound samples whole values');
  assert.deepEqual(sweep(-1e308, 1e308, 3), [-1e308, 0, 1e308], 'a span past Number.MAX_VALUE stays finite');
  for (const [min, max, count] of [[-8e307, 8e307, 5], [0, 1.7e308, 4]]) {
    const out = sweep(min, max, count).filter((v) => !(Number.isFinite(v) && v >= min && v <= max));
    assert.deepEqual(out, [], `a span whose product with the index passes Number.MAX_VALUE stays finite and in range: ${min}..${max} at ${count}`);
  }
  let checked = 0, wrong = 0, first = null;
  for (let min = -20; min <= 20; min++) {
    for (let max = min + 1; max <= min + 60; max++) {
      for (let count = 2; count <= 32; count++) {
        sweep(min, max, count).forEach((v, i) => {
          if (((max - min) * i) % (count - 1) !== 0) return;
          checked++;
          const want = min + ((max - min) * i) / (count - 1);
          if (v !== want) { wrong++; first ??= `${min}..${max} at ${count}, index ${i}: ${v}`; }
        });
      }
    }
  }
  assert.equal(wrong, 0, `${wrong} of ${checked} whole samples are off, first ${first}`);
});

test('contact sheet: a grid covers the Cartesian product with the first parameter in columns', (t) => {
  // An empty ARTIFEX_HOME, so an installed pack cannot change the unknown-name hint below.
  const fs = require('node:fs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-seeds-home-'));
  const saved = process.env.ARTIFEX_HOME;
  process.env.ARTIFEX_HOME = home;
  t.after(() => {
    if (saved === undefined) delete process.env.ARTIFEX_HOME; else process.env.ARTIFEX_HOME = saved;
    fs.rmSync(home, { recursive: true, force: true });
  });
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
  // An unknown name says how to pass a piece of one's own; an unknown parameter, what --param does.
  const known = Object.keys(require('../examples/index.js')).join(', ');
  assert.throws(() => page(['constructor'], 3, 1), { message: `seeds: no example called "constructor". Known: ${known}. For your own piece, pass its path, such as ./constructor.cjs\n${USAGE}` });
  assert.throws(() => page(['drift'], 3, 1, ['missing']), { message: `seeds: unknown parameter "missing" for drift. Declared: strokes, reach, turn. --param names one or two of them to sweep from their min to their max\n${USAGE}` });
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

test('contact sheet: measureFrame counts marks after reset() or a restore() past the cell\'s save, clears a reset that restore() undoes, and reads the transform only at transform calls', () => {
  // The draw opens and closes the cell as core/render.js drawFrame does.
  const cell = (piece) => {
    const g = nullSurface({ w: 4, h: 4 }), get = g.getTransform;
    let reads = 0;
    Object.assign(g, {
      canvas: { width: 4, height: 4 },
      getImageData: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }),
      getTransform: () => { reads++; return get(); },
    });
    const m = measureFrame(g, (s) => { s.save(); s.scale(0.5, 0.5); try { piece(s); } finally { s.restore(); } }, null, 0.5);
    return { unscaled: m.unscaled, reads };
  };
  assert.equal(cell((s) => { s.reset(); s.fillRect(0, 0, 1, 1); s.fillRect(1, 1, 1, 1); }).unscaled, 2, 'reset()');
  assert.equal(cell((s) => { s.restore(); s.fillRect(0, 0, 1, 1); }).unscaled, 1, "a restore() that pops the cell's save");
  assert.equal(cell((s) => { s.save(); s.setTransform(1, 0, 0, 1, 0, 0); s.fillRect(0, 0, 1, 1); s.restore(); s.scale(2, 2); s.fillRect(0, 0, 1, 1); }).unscaled, 1, 'a restore() undoes the reset made after its save');
  const many = cell((s) => { s.setTransform(1, 0, 0, 1, 0, 0); for (let i = 0; i < 50; i++) s.fillRect(0, 0, 1, 1); });
  assert.equal(many.unscaled, 50);
  assert.ok(many.reads <= 2, `read the transform ${many.reads} times for 50 marks`);
  assert.equal(cell((s) => s.fillRect(0, 0, 1, 1)).unscaled, 0, 'a kept scale');
  // Once the closing restore() ends the count, a finish's transform calls read nothing.
  const done = nullSurface({ w: 4, h: 4 }), doneGet = done.getTransform;
  let doneReads = 0, atClose = -1;
  Object.assign(done, {
    canvas: { width: 4, height: 4 },
    getImageData: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }),
    getTransform: () => { doneReads++; return doneGet(); },
  });
  measureFrame(done, (s) => {
    s.save(); s.scale(0.5, 0.5); s.setTransform(1, 0, 0, 1, 0, 0); s.fillRect(0, 0, 1, 1); s.restore();
    atClose = doneReads; s.restore();
    s.save(); s.scale(2, 2); s.translate(1, 1); s.setTransform(1, 0, 0, 1, 0, 0); s.reset(); s.restore();
  }, null, 0.5);
  assert.ok(atClose > 0, 'the count read the transform before it ended');
  assert.equal(doneReads, atClose, 'getTransform reads after the count ended');
  const g = Object.assign(nullSurface({ w: 4, h: 4 }), { canvas: { width: 4, height: 4 }, getImageData: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }) });
  // A finish paints after drawFrame's closing restore(), at its own transform.
  const finish = measureFrame(g, (s) => {
    s.save(); s.scale(0.5, 0.5); s.fillRect(0, 0, 1, 1); s.restore();
    s.save(); s.scale(2, 2); s.scale(0.5, 0.5); s.fillRect(0, 0, 1, 1); s.restore();
  }, null, 0.5);
  assert.equal(finish.unscaled, 0, "marks after the cell's closing restore()");
  assert.equal('unscaled' in measureFrame(g, (s) => s.fillRect(0, 0, 1, 1)), false, 'no scale, no unscaled count');
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
  // A piece may declare keys that differ only in case; their sweeps write files
  // whose names differ in more than case, so neither replaces the other on Windows.
  const swept = [['reach'], ['Reach'], ['REACH'], ['reach', 'Turn'], ['reach', 'turn']].map((keys) => path.basename(sheetStem(['drift'], keys)).toLowerCase());
  assert.equal(new Set(swept).size, 5, `case-folded stems collide: ${swept.join(', ')}`);
  // A key holding "-" never names the sheet of the keys on either side of it.
  assert.notEqual(sheetStem(['drift'], ['a-b']), sheetStem(['drift'], ['a', 'b']), 'the key a-b and the keys a, b name different sheets');
  assert.equal(sheetStem(['drift'], ['a-b']), path.join(out, 'drift-param-a%2Db'));
  const external = { directory: path.join(path.sep, 'work', 'piece'), stem: 'my-piece' };
  assert.equal(sheetStem(['mine'], ['width'], external), path.join(path.sep, 'work', 'piece', 'my-piece-param-width'), 'an external piece writes beside itself');
  const fixtures = path.join(__dirname, 'fixtures');
  const fixture = { directory: fixtures, stem: 'gradient-film' };
  assert.equal(sheetStem(['gradient-film'], [], fixture, null, { frames: 3 }), path.join(out, 'pieces', 'tests', 'fixtures', 'gradient-film-frames'),
    'a piece inside the library writes under out/, never into its tracked folder');
  assert.notEqual(sheetStem(['drift'], [], { directory: fixtures, stem: 'drift' }), sheetStem(['drift'], []),
    'a fixture named like a registered example keeps that example\'s sheet');
  // A piece already in an untracked folder writes beside itself, not under a doubled out/pieces/out/ path.
  // Git decides what it ignores: the mutation suite's copy has no Git, so there only out/ is untracked.
  const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' }).status === 0;
  for (const directory of [path.join(out, 'scratch'), ...(git ? [path.join(__dirname, '..', '.private', 'pieces')] : [])]) {
    assert.equal(sheetStem(['p'], [], { directory, stem: 'p' }), path.join(directory, 'p-seeds'), 'a piece in an untracked folder writes beside itself');
  }
  // A piece at the top of out/ named like a registered example keeps that example's sheet.
  assert.equal(sheetStem(['drift'], [], { directory: out, stem: 'drift' }), path.join(out, 'pieces', 'drift-seeds'),
    'a piece at the top of out/ writes under out/pieces/');
  const root = path.join(__dirname, '..');
  assert.equal(inLibrary(path.join(fixtures, 'a.png')), path.join('tests', 'fixtures', 'a.png'), 'a path inside the library is shown from its root');
  assert.equal(inLibrary(path.join(root, '..cache', 'a.png')), path.join('..cache', 'a.png'), 'a folder whose name starts with two dots is still inside');
  assert.equal(inLibrary(root), '');
  for (const outside of [path.join(root, '..', 'other', 'a.png'), path.join(path.sep, 'work', 'piece')]) assert.equal(inLibrary(outside), null, outside);
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
  assert.throws(() => sheetPlans(['refit'], 3, [], null, { w: 100, h: 100 }),
    { message: `seeds: refit cannot draw at 100 x 100: w 100 is outside the declared [240, 1920]; it takes widths 240 to 1920 and heights 240 to 1920\n${USAGE}` });
  assert.throws(() => sheetPlans(['drift'], 3, [], null, { w: 405, h: 720 }), /drift declares no boxes/);
  const html = page(['refit'], 2, 1, [], null, { w: 405, h: 720 });
  assert.match(html, /var BOX = \{"w":405,"h":720\};/);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
});

test('contact sheet: --reframe plays one piece along a box timeline written t:WxH,... and atBox refuses one it cannot play by name', () => {
  const keys = [{ t: 0, w: 1280, h: 720 }, { t: 1, w: 405, h: 720 }];
  assert.deepEqual(parseArgs(['refit', '--frames', '3', '--reframe', '0:1280x720,1:405x720']).box, keys);
  assert.deepEqual({ ...parseArgs(['refit', '--reframe', '0:1280x720,1:405x720']), box: null }, parseArgs(['refit']), 'it changes nothing else');
  for (const [args, why] of [
    [['--reframe', '0:1280x720,1:405x720'], /name one piece when using --reframe/],
    [['refit', '--reframe'], /--reframe needs a box timeline/],
    [['refit', '--reframe', '0:1280x720,405x720'], /--reframe: box 1, "405x720", must be t:WIDTHxHEIGHT/],
    [['refit', '--box', '405x720', '--reframe', '0:1280x720,1:405x720'], /--box or --reframe only once/],
  ]) assert.throws(() => parseArgs(args), why, args.join(' '));
  const out = path.join(__dirname, '..', 'out');
  assert.equal(sheetStem(['refit'], [], null, keys, { frames: 3 }), path.join(out, 'refit-frames-reframe'));
  const strip = sheetPlans(['refit'], 3, [], null, keys, { frames: 3 })[0];
  assert.equal(strip.length, 3);
  // The rules are atBox's, so a timeline refit cannot play is refused by name before a page is written.
  assert.throws(() => sheetPlans(['refit'], 3, [], null, [{ t: 0.5, w: 1280, h: 720 }, { t: 0.5, w: 405, h: 720 }]),
    /refit cannot play that box timeline: reframe\[1\]\.t must come after reframe\[0\]\.t/);
  assert.throws(() => sheetPlans(['refit'], 3, [], null, [{ t: 0, w: 1280, h: 720 }, { t: 1, w: 100, h: 720 }]),
    /refit cannot play that box timeline: box 1, 100 x 720/);
  assert.throws(() => sheetPlans(['drift'], 3, [], null, keys), /drift cannot play that box timeline: drift declares no boxes/);
  const html = page(['refit'], 3, 1, [], null, keys, { frames: 3 });
  assert.match(html, /var BOX = \[\{"t":0,"w":1280,"h":720\},\{"t":1,"w":405,"h":720\}\];/);
});

// A style draws nothing, so every mode refuses --style once in parseArgs, in either form, before it reads the other arguments.
test('contact sheet: every mode refuses --style and --style=<name> with the style\'s guide and module paths', async (t) => {
  const modes = [['sheet', ['drift', '9']], ['strip', ['drift', '--frames', '3']], ['--compare', ['--compare', 'a.png', 'b.png']], ['--plan', ['x.cjs', '--plan']]];
  for (const [mode, base] of modes) {
    for (const [form, extra] of [['--style <name>', ['--style', 'impasto']], ['--style=<name>', ['--style=impasto']]]) {
      await t.test(`${mode} ${form}`, () => {
        assert.throws(() => parseArgs([...base, ...extra]), (e) => e.message === `seeds: ${styleCause('impasto')}\n${USAGE}`
          && /--style draws nothing/.test(e.message) && /impasto\.md/.test(e.message) && /impasto\.js/.test(e.message) && !/takes only|takes one piece|unknown option/.test(e.message));
      });
    }
  }
});

test('contact sheet: every mode refuses a missing or flag-like --style name as a missing name', async (t) => {
  const modes = [['sheet', ['drift']], ['--compare', ['--compare', 'a.png', 'b.png']], ['--plan', ['x.cjs', '--plan']]];
  for (const [mode, base] of modes) {
    for (const [form, extra] of [['--style', ['--style']], ['--style --json', ['--style', '--json']], ['--style=', ['--style=']]]) {
      await t.test(`${mode} ${form}`, () => {
        assert.throws(() => parseArgs([...base, ...extra]), (e) => /--style needs a style name; npm run styles lists them/.test(e.message) && !/no style named/.test(e.message));
      });
    }
  }
});

test('contact sheet: --frames spreads a time strip from the first frame to the last at the piece seed, 640 px wide', () => {
  const args = parseArgs(['readout', '--frames', '9', '--png']);
  assert.deepEqual(args.strip, { frames: 9, at: null, scale: null, loupe: null, shots: false, sound: false });
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

test('contact sheet: --session draws a saved session as a time strip at its own seed, named after the file, and refuses what a session fixes', () => {
  const { readSession } = require('../tools/contact-sheet.js');
  const play = require('../core/play.js');
  const s = play.session(EXAMPLES.noughts, 9);
  for (let k = 1; k <= 90; k++) s.advance(k === 5 ? [{ kind: 'down', x: 130, y: 120 }] : []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-session-'));
  try {
    fs.writeFileSync(path.join(dir, 'game.session.json'), JSON.stringify(s.save()));
    const args = parseArgs(['noughts', '--frames', '6', '--session', 'game.session.json']);
    assert.deepEqual(args.strip.session, { path: 'game.session.json' });
    const session = readSession(args.strip, 'noughts', null, dir);
    assert.equal(session.name, 'game.session.json');
    assert.deepEqual(Object.keys(session), ['path', 'file', 'name'], 'the film stays out of the strip\'s JSON');
    const strip = { ...args.strip, session };
    const [cells] = sheetPlans(['noughts'], 6, [], null, null, strip);
    // 90 ticks make 91 frames, tick 0 to tick 90.
  assert.deepEqual(cells.map((cell) => cell.frame), [0, 18, 36, 54, 72, 90]);
    assert.ok(cells.every((cell) => cell.seed === 9), 'the session\'s seed');
    assert.equal(path.basename(sheetStem(['noughts'], [], null, null, strip)), 'noughts-frames-game');
    const html = page(['noughts'], 6, 1, [], null, null, strip);
    assert.match(html, /var SESSION = \{"file":\{"artifex"/);
    assert.match(html, /req\('core\/play\.js'\)\.film\(EX\[NAMES\[0\]\], SESSION\.file, SESSION\.name\)/);
    // What a session fixes is refused beside it, and a strip of a piece with play needs one.
    assert.throws(() => parseArgs(['noughts', '--session', 'game.session.json']), /--session draws a saved session as a time strip; add --frames/);
    assert.throws(() => parseArgs(['noughts', '--frames', '6', '--session', 'g.json', '--seed', '3']), /give --seed or --session, not both/);
    assert.throws(() => parseArgs(['noughts', '--frames', '6', '--session', 'g.json', '--box', '720x480']), /a session plays at the box it was played at; drop --box/);
    assert.throws(() => parseArgs(['noughts', '--frames', '6', '--session']), /--session needs the session file/);
    assert.throws(() => planStrip(validate(EXAMPLES.noughts), { frames: 6 }), /^Error: seeds: noughts is interactive, so its frames come from a session somebody played; save one in the page and add --session <file>/);
    assert.throws(() => readSession({ session: { path: 'none.json' } }, 'noughts', null, dir), /--session: no session file at .*none\.json/);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{');
    assert.throws(() => readSession({ session: { path: 'bad.json' } }, 'noughts', null, dir), /--session: .*bad\.json is not JSON/);
    assert.throws(() => readSession({ session: { path: 'game.session.json' } }, 'readout', null, dir), /--session: play: readout declares no play/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('contact sheet: an --at strip survives a later --loupe strip of the same piece', async () => {
  const { writePieces } = require('../tools/check-browser.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-1239-'));
  try {
    const external = { stem: 'mine', directory: dir };
    const stem = (argv) => { const a = parseArgs(argv); return sheetStem(a.names, a.paramNames, external, a.box, a.strip, a.seeds, a.views); };
    const plain = stem(['readout', '--at', '1,2']) + '.png', loupe = stem(['readout', '--at', '1,2', '--loupe']) + '.png';
    assert.notEqual(plain, loupe, 'the names differ');
    assert.match(path.basename(loupe), /^mine-at-loupe\.png$/);
    await writePieces(plain, [{ file: plain, png: Buffer.from('at strip') }]);
    await writePieces(loupe, [{ file: loupe, png: Buffer.from('loupe strip') }]);
    assert.equal(fs.readFileSync(plain, 'utf8'), 'at strip', 'the earlier --at strip is still there');
    assert.equal(fs.readFileSync(loupe, 'utf8'), 'loupe strip');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('contact sheet: --at shows the frame each second falls in and refuses a second outside the film', () => {
  const p = validate(EXAMPLES.readout);
  assert.deepEqual(parseArgs(['readout', '--at', '0,0.5,6.99']).strip.at, [0, 0.5, 6.99]);
  assert.deepEqual(planStrip(p, { at: [0, 0.5, 1.99, 6.99] }).cells.map((cell) => cell.frame), [0, 12, 47, 167]);
  assert.deepEqual(planStrip({ ...validate(EXAMPLES.readout), time: { ...p.time, hz: 100 } }, { at: [0.29] }).cells.map((cell) => cell.frame), [29],
    'a second a hair under a whole frame in floating point stays in that frame');
  for (const at of [[7], [-0.01]]) assert.throws(() => planStrip(p, { at }), /is outside readout's 7 s/, String(at));
});

test('contact sheet: --at seconds a frame apart that fall in one frame are named in a warning, with the frame centres to ask for', () => {
  const drift = validate(EXAMPLES.drift);
  const same = planStrip(drift, { at: [5.9, 5.933, 6] });
  assert.deepEqual(same.cells.map((cell) => cell.frame), [177, 177, 180]);
  assert.deepEqual(same.repeats, [{ frame: 177, at: [5.9, 5.933] }]);
  assert.equal(planStrip(drift, { at: [5.917, 5.95] }).repeats, undefined, 'frame centres land on consecutive frames');
  assert.deepEqual(planStrip(drift, { at: [5.917, 5.95] }).cells.map((cell) => cell.frame), [177, 178]);
  assert.equal(planStrip(drift, { at: [2, 2] }).repeats, undefined, 'a second named twice is asked for twice');
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), 'drift', '--at', '5.9,5.933'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /warning: --at 5\.9 and 5\.933 fall in frame 177, from 5\.9 to 5\.933 s at 30 fps, so their cells are the same picture; for consecutive frames give each frame's centre, \(frame \+ 0\.5\) \/ 30 s, such as 5\.917,5\.95/);
  const last = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), 'drift', '--at', '7.97,7.99'], { encoding: 'utf8' });
  assert.equal(last.status, 0, last.stderr);
  assert.match(last.stderr, /fall in frame 239, .* such as 7\.95,7\.983$/m, 'the film\'s last frame is paired with the frame before it');
  assert.deepEqual(planStrip(drift, { at: [7.95, 7.983] }).cells.map((cell) => cell.frame), [238, 239], 'the suggested centres are inside the film');
  const dir = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'artifex-one-frame-'));
  const piece = path.join(dir, 'one-frame.cjs');
  require('node:fs').writeFileSync(piece, "module.exports = { name: 'one-frame', size: { w: 64, h: 36 }, seed: 1, time: { hz: 30, duration: 1 / 30 },"
    + " draw(g) { g.fillStyle = '#888'; g.fillRect(0, 0, 64, 36); } };\n");
  const one = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), piece, '--at', '0,0.01'], { encoding: 'utf8' });
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stderr, /warning: --at 0 and 0\.01 fall in frame 0, .* so their cells are the same picture$/m, 'a film of one frame has no consecutive frames to suggest');
  // At 1000 fps three decimals would round the centres onto frame edges; the suggestion keeps enough to stay in the film.
  const khz = path.join(dir, 'khz.cjs');
  require('node:fs').writeFileSync(khz, "module.exports = { name: 'khz', size: { w: 64, h: 36 }, seed: 1, time: { hz: 1000, duration: 0.004 },"
    + " draw(g) { g.fillStyle = '#888'; g.fillRect(0, 0, 64, 36); } };\n");
  const fast = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), khz, '--at', '0.0031,0.0032'], { encoding: 'utf8' });
  assert.equal(fast.status, 0, fast.stderr);
  const suggested = /such as ([\d.]+,[\d.]+)$/m.exec(fast.stderr);
  assert.equal(suggested && suggested[1], '0.0025,0.0035');
  const again = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), khz, '--at', suggested[1]], { encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stderr, /warning/, 'the suggested centres fall in two frames inside the film');
});

test('contact sheet: an --at strip and a --frames strip of one piece keep separate names, whatever the strip adds', () => {
  const stem = (strip, box = null) => path.basename(sheetStem(['refit'], [], null, box, strip));
  assert.equal(stem({ frames: 9, at: null }), 'refit-frames');
  assert.equal(stem({ frames: null, at: [0, 1] }), 'refit-at');
  assert.equal(stem({ frames: null, at: [0], sound: true }), 'refit-at-sound');
  assert.equal(stem({ frames: null, at: [0, 1] }, { w: 405, h: 720 }), 'refit-at-405x720');
  assert.equal(stem({ frames: null, at: null, shots: true }), 'refit-shots');
});

test('contact sheet: an --at strip written after a --frames strip of the same piece leaves the --frames strip in place', () => {
  const fs = require('node:fs');
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), ...args], { encoding: 'utf8' });
  const paths = (result) => [...result.stdout.matchAll(/^(.+\.html)  \d/gm)].map((m) => path.resolve(__dirname, '..', m[1]));
  const frames = run('readout', '--frames', '3');
  assert.equal(frames.status, 0, frames.stderr);
  const [framesFile] = paths(frames);
  const before = fs.readFileSync(framesFile, 'utf8');
  const at = run('readout', '--at', '0,1');
  assert.equal(at.status, 0, at.stderr);
  const [atFile] = paths(at);
  assert.notEqual(atFile, framesFile, 'the two strips are written to different files');
  assert.ok(fs.existsSync(framesFile) && fs.existsSync(atFile), 'both strips exist afterwards');
  assert.equal(fs.readFileSync(framesFile, 'utf8'), before, 'the --frames strip is unchanged');
});

test('contact sheet: a still takes --at 0, and with it --scale and --loupe, as a strip of its one frame', () => {
  const p = validate(EXAMPLES.specimen);
  const args = parseArgs(['specimen', '--at', '0', '--scale', '1', '--loupe', '--png']);
  const strip = planStrip(p, args.strip);
  assert.deepEqual(strip.cells.map((cell) => [cell.frame, cell.t, cell.seconds]), [[0, 0, 0]]);
  assert.deepEqual([strip.frames, strip.hz, strip.width, strip.columns], [1, null, p.size.w, 1]);
  assert.equal(strip.loupe.w, Math.min(p.size.w, strip.loupe.W), 'the loupe crops the still at its 100% scale');
  for (const bad of [{ at: [0.5] }, { at: [0, 1] }, { frames: 2 }, { shots: true }]) {
    assert.throws(() => planStrip(p, bad), /specimen is a still; a time strip needs a timeline, and --at 0 shows the still itself/, JSON.stringify(bad));
  }
  const html = page(['specimen'], 1, 1, [], null, null, args.strip);
  assert.match(html, /STRIP\.hz \? STRIP\.frames/, 'the note names a still instead of its frames per second');
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
});

const stillArgs = () => parseArgs(['specimen', '--at', '0', '--loupe']);

test('contact sheet: the line seeds prints for a still says a still, not "1 of 1 frames"', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), ...args], { encoding: 'utf8' });
  const still = run('specimen', '--at', '0', '--loupe');
  assert.equal(still.status, 0, still.stderr);
  assert.match(still.stdout, /^1 piece\(s\) x a still at seed \d+, \d+ px wide, with a 100% crop\./m);
  const film = run('readout', '--at', '0');
  assert.match(film.stdout, /^1 piece\(s\) x 1 of 168 frames at seed /m, 'a timeline piece keeps its frames');
});

test('contact sheet: a still strip is titled a still, and a timeline piece with one frame keeps its frames', () => {
  assert.match(page(['specimen'], 1, 1, [], null, null, stillArgs().strip), /<title>Artifex — a still<\/title>/);
  assert.match(page(['readout'], 1, 1, [], null, null, { at: [0] }), /<title>Artifex — 1 frames<\/title>/);
});

test('contact sheet: a still strip captions and reports the still, with no frame or hold sentence', () => {
  const { elements } = runStrip(stillArgs().strip, {}, 'specimen');
  const text = elements.map((el) => el.textContent).filter(Boolean);
  assert.ok(text.includes('the still'), 'the caption');
  const report = text.find((t) => /^The still is (not )?nearly empty\. Detail is/.test(t));
  assert.ok(report && !/frame|hold/.test(report), 'the report');
});

test('contact sheet: --timeout-ms sets the --png browser limit and refuses a missing or wrong value by name', () => {
  assert.equal(parseArgs(['readout', '--frames', '3', '--loupe', '--png', '--timeout-ms', '240000']).timeoutMs, 240000);
  assert.equal(parseArgs(['drift', '--png', '--timeout-ms', '100']).timeoutMs, 100, 'a seed sheet takes it too');
  assert.equal('timeoutMs' in parseArgs(['drift', '--png']), false, 'without it the browser keeps its default');
  for (const bad of [['--png', '--timeout-ms'], ['--png', '--timeout-ms', '--frames', '3']]) {
    assert.throws(() => parseArgs(['readout', ...bad]), /^Error: seeds: --timeout-ms needs a number of milliseconds\nusage: seeds /, bad.join(' '));
  }
  for (const ms of ['99', '3600001', '1.5', 'soon']) {
    assert.throws(() => parseArgs(['readout', '--png', '--timeout-ms', ms]), new RegExp(`^Error: seeds: --timeout-ms takes an integer from 100 to 3600000 milliseconds \\(default 60000\\), got ${ms.replace('.', '\\.')}\\nusage: seeds `), ms);
  }
  assert.throws(() => parseArgs(['readout', '--timeout-ms', '1000']), /--timeout-ms limits the browser that --png or --json starts; add one/);
  assert.throws(() => parseArgs(['readout', '--png', '--timeout-ms', '1000', '--timeout-ms', '2000']), /use --timeout-ms only once/);
});

test('contact sheet: --json asks for the sheet\'s data, alone or with --png, on a seed sheet or a strip', () => {
  assert.equal(parseArgs(['drift', '4', '0.5', '--json']).json, true);
  assert.equal(parseArgs(['--json', 'readout', '--frames', '5', '--png']).json, true, 'the option goes anywhere, and goes with --png');
  assert.equal(parseArgs(['drift', '--png']).json, false, 'without it nothing is printed');
  assert.deepEqual({ ...parseArgs(['drift', '--json', '--param', 'reach']), json: undefined },
    { ...parseArgs(['drift', '--param', 'reach']), json: undefined }, 'it changes nothing else');
  assert.equal(parseArgs(['drift', '--json', '--timeout-ms', '5000']).timeoutMs, 5000, 'it starts the browser --timeout-ms limits');
});

test('contact sheet: --json waits for window.__sheet, sound and all, and reads it as plain data with its failures counted', () => {
  const { sheetReady, sheetData } = require('../tools/check-browser.js');
  const saved = { window: globalThis.window };
  try {
    // A --sound strip holds window.__sheet back until its soundtrack has drawn.
    globalThis.window = {};
    assert.equal(sheetReady(2), false, 'no sheet yet');
    const cells = [{ markCount: 4, detail: 12.5, drawMs: 1.2, frame: 0 }, { error: 'draw: boom' }];
    globalThis.window.__sheet = { names: ['readout'], cells: cells.slice(0, 1), strip: { frames: 2 }, flags: { empty: [], holds: [] }, failures: () => 1 };
    assert.equal(sheetReady(2), false, 'a cell still drawing');
    globalThis.window.__sheet.cells = cells;
    globalThis.window.__sheet.sound = { error: null, seconds: 7 };
    assert.equal(sheetReady(2), true);
    globalThis.window.document = { images: [{ complete: false }] };
    assert.equal(sheetReady(2), false, 'a --reference photo still loading');
    globalThis.window.document.images[0].complete = true;
    assert.equal(sheetReady(2), true);
    delete globalThis.window.document;
    const data = sheetData();
    assert.deepEqual(JSON.parse(JSON.stringify(data)), {
      names: ['readout'], cells, strip: { frames: 2 }, flags: { empty: [], holds: [] }, sound: { error: null, seconds: 7 }, failures: 1,
    }, 'every field survives JSON, and failures is a count');
  } finally {
    if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
  }
});

test('contact sheet: --json alone reads window.__sheet and never takes a screenshot', async () => {
  const { captureSheet } = require('../tools/check-browser.js');
  const sheet = { names: ['drift'], cells: [{ markCount: 4 }], failures: 0 };
  // A stand-in page: every expression runs in it as Edge would run it, so the
  // test holds whatever wording the helpers use, and a capture reaches the
  // screenshot, which throws instead of writing a file.
  const heading = { textContent: 'drift', getBoundingClientRect: () => ({ top: 0 }) };
  const page = vm.createContext({
    window: { __sheet: { ...sheet, failures: () => 0 }, scrollY: 0 },
    document: { querySelectorAll: () => [heading] },
  });
  const methods = [];
  const client = {
    async send(method, params) {
      methods.push(method);
      if (method === 'Page.getLayoutMetrics') return { cssContentSize: { width: 1280, height: 600 } };
      if (method === 'Page.captureScreenshot') throw new Error('stand-in: screenshot taken');
      if (method !== 'Runtime.evaluate') return {};
      return { result: { value: await vm.runInContext(params.expression, page) } };
    },
  };
  const edge = (html, options, work) => work(client, { errors: [], phase: null });
  const result = await captureSheet('<html></html>', 'unused', { cells: 1, images: false }, edge).catch((error) => error);
  assert.equal(methods.filter((m) => m === 'Page.captureScreenshot').length, 0, 'no screenshot under images:false');
  assert.deepEqual(result, { shots: [], cells: 1, failures: 0, sheet });
  assert.ok(methods.includes('Runtime.evaluate'), 'the stand-in client was used');
});

test('contact sheet: --png writes no image of a sheet that carries a refusal', async () => {
  const { captureSheet } = require('../tools/check-browser.js');
  const sheet = { names: ['twice'], cells: [{ error: 'refused' }], failures: 1, refusal: 'refused' };
  const page = vm.createContext({ window: { __sheet: { ...sheet, failures: () => 1 }, scrollY: 0 }, document: { querySelectorAll: () => [] } });
  const methods = [];
  const client = {
    async send(method, params) {
      methods.push(method);
      if (method === 'Page.getLayoutMetrics') return { cssContentSize: { width: 1280, height: 600 } };
      if (method === 'Page.captureScreenshot') throw new Error('stand-in: screenshot taken');
      if (method !== 'Runtime.evaluate') return {};
      return { result: { value: await vm.runInContext(params.expression, page) } };
    },
  };
  const edge = (html, options, work) => work(client, { errors: [], phase: null });
  const result = await captureSheet('<html></html>', 'unused', { cells: 1, images: true }, edge).catch((error) => error);
  assert.deepEqual(methods.filter((m) => m.startsWith('Page.')), [], 'no measuring or screenshot of a refused sheet');
  assert.deepEqual(result, { shots: [], cells: 1, failures: 1, sheet });
});

test('contact sheet: --shots shows each shot of state.cues.shots at its first, middle and last frame, one row a shot', () => {
  const args = parseArgs(['cues', '--shots', '--png']);
  assert.deepEqual(args.strip, { frames: null, at: null, scale: null, loupe: null, shots: true, sound: false });
  const p = validate(EXAMPLES.cues);
  const film = solve(p, p.seed).state.cues.shots;
  const strip = planStrip(p, args.strip);
  assert.deepEqual(strip.cells.map((cell) => [cell.shot, cell.mark, cell.frame]), film.flatMap((s) => [
    [s.name, 'first', s.start], [s.name, 'middle', Math.floor((s.start + s.end - 1) / 2)], [s.name, 'last', s.end - 1]]));
  assert.deepEqual(strip.cells.slice(0, 3).map((cell) => cell.frame), [0, 23, 47], 'cues opens on a 2 s shot of 48 frames at 24 Hz');
  assert.equal(strip.columns, 3, 'each shot takes one row');
  assert.equal(planStrip(p, { shots: true, scale: 0.1 }).columns, 3, 'a narrow cell still keeps one shot to a row');
  assert.equal(sheetStem(['cues'], [], null, null, args.strip), path.join(__dirname, '..', 'out', 'cues-shots'));
  assert.deepEqual(planStrip(validate(EXAMPLES.readout), { shots: true }).cells.map((cell) => cell.frame), [0, 71, 143, 144, 155, 167]);
  assert.throws(() => planStrip(validate(EXAMPLES.drift), { shots: true }),
    /--shots reads drift's shot list from state\.cues\.shots, the list shots\(\) returns, and drift keeps none there/);
  for (const bad of [['cues', '--shots', '--frames', '3'], ['cues', '--shots', '--at', '1'], ['--shots'], ['cues', '3', '--shots']]) {
    assert.throws(() => parseArgs(bad), /seeds/, bad.join(' '));
  }
  const html = page(['cues'], 0, 1, [], null, null, args.strip);
  assert.match(html, /cell\.shot \+ ', ' \+ cell\.mark/);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
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

test('contact sheet: --reference shows a photo at its centre, pixel for pixel, the size of a 100% crop', async () => {
  const photo = path.join(__dirname, '..', 'skills', 'artifex', 'styles', 'references', 'papercraft', 'torn-paper.webp');
  const ref = (...more) => parseArgs(['readout', '--frames', '3', '--loupe', '--reference', ...more]).reference;
  assert.deepEqual(ref(photo), { file: photo, at: null, scale: 1 });
  assert.deepEqual(ref('a@2x.webp@512,300.5', '--reference-scale', '0.5'), { file: 'a@2x.webp', at: { x: 512, y: 300.5 }, scale: 0.5 });
  assert.equal(parseArgs(['readout', '--frames', '3']).reference, null);
  assert.throws(() => parseArgs(['readout', '--frames', '3', '--reference', photo]), /--reference shows the photo beside the 100% crops; add --loupe/);
  for (const bad of ['photo.gif', 'photo.webp@512', 'photo.webp@-1,2', 'photo.webp@1,2,3', 'photo.webp@', '@1,2']) {
    assert.throws(() => ref(bad), /--reference needs a photo: a \.webp, \.png or \.jpg file, then optionally @x,y/, bad);
  }
  for (const bad of ['0', '-1', 'x', undefined]) {
    assert.throws(() => ref(photo, '--reference-scale', ...(bad === undefined ? [] : [bad])), /--reference-scale needs a positive plain decimal number/, String(bad));
  }
  assert.throws(() => ref(photo, '--reference-scale', '2', '--reference-scale', '2'), /use --reference-scale only once/);
  assert.throws(() => parseArgs(['readout', '--frames', '3', '--loupe', '--reference-scale', '2']), /--reference-scale scales the --reference photo; add --reference/);
  assert.throws(() => parseArgs(['drift', '9', '--reference', photo]), /add --loupe and --frames, --at, --shots or --contacts/);

  // The part of the photo each crop takes: the centre at 1, a point kept inside the photo, and scaled.
  const loupe = { w: 640, h: 427 };
  assert.deepEqual(photoCrop(1024, 1024, loupe), { x: 512, y: 512, scale: 1, w: 640, h: 427, sx: 192, sy: 298, sw: 640, sh: 427 });
  assert.deepEqual(photoCrop(1024, 1024, loupe, { x: 1000, y: 10 }), { x: 1000, y: 10, scale: 1, w: 640, h: 427, sx: 384, sy: 0, sw: 640, sh: 427 });
  assert.deepEqual(photoCrop(1024, 1024, loupe, null, 2), { x: 512, y: 512, scale: 2, w: 640, h: 427, sx: 352, sy: 405, sw: 320, sh: 213 },
    'a scale that does not divide the crop takes whole photo rows, so the last row is drawn full');
  assert.deepEqual(photoCrop(1024, 1024, loupe, null, 3), { x: 512, y: 512, scale: 3, w: 640, h: 427, sx: 405, sy: 441, sw: 213, sh: 142 });
  assert.deepEqual(photoCrop(1024, 1024, loupe, null, 0.5), { x: 512, y: 512, scale: 0.5, w: 640, h: 427, sx: 0, sy: 85, sw: 1024, sh: 854 },
    'a crop wider than the photo takes the whole width');
  assert.equal(photoCrop(1024, 1024, loupe, null, 427).sh, 1, 'the largest scale that fits keeps one photo row');
  for (const bad of [428, 500]) {
    assert.throws(() => photoCrop(1024, 1024, loupe, null, bad), new RegExp(`--reference-scale ${bad} leaves no whole photo pixel in the 640 x 427 crop; the largest scale that fits is 427`), String(bad));
  }
  assert.throws(() => photoCrop(1024, 1024, loupe, { x: 1025, y: 0 }), /--reference point 1025,0 is outside the photo's 1024 x 1024 pixels/);
  for (const [x, y] of [[1024, 0], [0, 1024], [1024, 1024]]) {
    assert.throws(() => photoCrop(1024, 1024, loupe, { x, y }), new RegExp(`--reference point ${x},${y} is outside`), 'a point at the photo\'s width or height is past its last pixel');
  }
  assert.equal(photoCrop(1024, 1024, loupe, { x: 1023.5, y: 1023 }).sx, 384, 'the last pixel is inside');

  // The crop is cut in the browser and read back in pieces, as a reply over 4 MiB
  // is refused, and only its data URL reaches the sheet.
  const expressions = [];
  const held = JSON.stringify('data:image/png;base64,CROP');
  const client = {
    async send(method, { expression }) {
      expressions.push(expression);
      const piece = /__artifexValue\.slice\((\d+), (\d+)\)/.exec(expression);
      const value = expression.includes('toDataURL') ? held.length
        : expression.includes('createImageBitmap') ? { W: 1024, H: 1024 } : piece ? held.slice(Number(piece[1]), Number(piece[2])) : true;
      return { result: { value } };
    },
  };
  const edge = async (html, options, work) => { assert.equal(options.file.length, require('node:fs').statSync(photo).size); return work(client, { errors: [], phase: null }); };
  const cut = await cropReference(photo, loupe, { at: null, scale: 1 }, undefined, edge);
  assert.deepEqual({ ...cut, bytes: undefined }, { name: 'torn-paper.webp', at: null, bytes: undefined, photo: { W: 1024, H: 1024 }, src: 'data:image/png;base64,CROP',
    x: 512, y: 512, scale: 1, w: 640, h: 427, sx: 192, sy: 298, sw: 640, sh: 427 });
  const drawn = expressions.find((e) => e.includes('toDataURL'));
  assert.match(drawn, /"sx":192,"sy":298,"sw":640,"sh":427/, 'the browser draws the crop photoCrop chose');
  assert.ok(expressions.some((e) => e.includes('__artifexValue.slice(')), 'the data URL is read back in pieces');
  assert.match(drawn, /imageSmoothingEnabled = c\.scale < 1[\s\S]*toDataURL\('image\/png'\), webp = canvas\.toDataURL\('image\/webp', 1\)/, 'unsmoothed at 1 and encoded losslessly');
  assert.match(drawn, /webp\.length >= png\.length\) return png;[\s\S]*if \(want\[i\] !== got\[i\]\) return png;\s*return webp;/,
    'a WebP is kept only when smaller than the PNG and decoded to the same pixels');
  await assert.rejects(cropReference(photo, loupe, { at: { x: 2000, y: 0 }, scale: 1 }, undefined, edge), /^Error: seeds: --reference point 2000,0 is outside/);
  await assert.rejects(cropReference('missing.webp', loupe, {}, undefined, edge), /--reference cannot read missing\.webp: ENOENT/);

  const html = page(['readout'], 3, 1, [], null, null, { frames: 3, loupe: true }, cut);
  assert.ok(html.includes('<div class="photo" style="width:640px;height:427px"><img id="reference-photo" src="data:image/png;base64,CROP"'));
  assert.ok(!html.includes(require('node:fs').readFileSync(photo).toString('base64').slice(0, 200)), 'the whole photo is not inlined');
  assert.match(html, /reference photo torn-paper\.webp · 100%, centre, 640 × 427 photo px from \(192, 298\)<\/figcaption>/);
  const captioned = (W, H, at, scale) => page(['readout'], 3, 1, [], null, null, { frames: 3, loupe: true }, { ...cut, at, ...photoCrop(W, H, loupe, at, scale) });
  assert.match(captioned(1024, 1024, { x: 1000, y: 10 }, 0.5), /reference photo torn-paper\.webp · 50%, around \(1000, 10\), 1024 × 854 photo px from \(0, 0\)<\/figcaption>/);
  assert.match(captioned(300, 200, null, 1), /reference photo torn-paper\.webp · 100%, centre, 300 × 200 photo px from \(0, 0\)<\/figcaption>/,
    'a photo smaller than the crop is captioned with its own size, not the cell\'s');
  assert.match(captioned(1024, 1024, null, 2), /· 200%, centre, 320 × 213 photo px from \(352, 405\)<\/figcaption>/);
  assert.match(html, /if \(photo\) sheet\.appendChild\(photo\)/, 'the photo is the strip\'s first cell');
  assert.ok(!page(['readout'], 3, 1, [], null, null, { frames: 3, loupe: true }).includes('id="reference"'));
});

// An image `width` x `height` whose pixel (x, y) is the RGBA `rgba(x, y)`.
const rgbaImage = (width, height, rgba) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(rgba(x, y), (y * width + x) * 4);
  return { width, height, data };
};
const { oklch } = require('../core/colour.js');
const lightnessOf = (v) => oklch('#' + v.toString(16).padStart(2, '0').repeat(3))[0];
const near = (got, want, what, eps = 1e-9) => assert.ok(Math.abs(got - want) < eps, `${what}: ${got}, not ${want}`);

test('contact sheet: styleStats bins colour in OKLab and measures lightness, chroma and brightness over the counted pixels', () => {
  const [L, C, h] = oklch('#c8643c');
  const flat = styleStats(rgbaImage(8, 6, () => [0xc8, 0x64, 0x3c, 255]));
  assert.equal(flat.pixels, 48);
  near(flat.chroma, C, 'chroma is OKLab chroma, as core/colour.js has it');
  const bin = (v, lo, size, count) => Math.max(0, Math.min(count - 1, Math.floor((v - lo) / size)));
  const at = (bin(L, 0, 0.1, 10) * 11 + bin(C * Math.cos(h), -0.33, 0.06, 11)) * 11 + bin(C * Math.sin(h), -0.33, 0.06, 11);
  assert.equal(flat.colour.length, 10 * 11 * 11);
  assert.equal(flat.colour[at], 1, 'one colour fills one bin');
  assert.equal(flat.lightness[Math.floor(L / 0.05)], 1);
  assert.deepEqual([flat.bright, flat.gradient, flat.fine, flat.textureLight, flat.textureDark], [0, 0, 0, null, null], 'a flat mid tone has no edge, no texture and no highlight');
  const white = styleStats(rgbaImage(5, 5, () => [255, 255, 255, 255]));
  assert.deepEqual([white.bright, white.textureLight, white.textureDark], [1, 0, null]);
  near(white.chroma, 0, 'white has no chroma', 1e-6);
  assert.equal(white.colour[(9 * 11 + 5) * 11 + 5], 1, 'grey sits in the middle a and b steps');
  const none = styleStats(rgbaImage(4, 4, () => [0, 0, 0, 0]));
  assert.deepEqual([none.pixels, none.chroma, none.gradient, none.textureDark], [0, null, null, null], 'a crop with no pixel measures nothing');
});

test('contact sheet: styleStats counts fine lines, the gradient and texture from each pixel\'s neighbours', () => {
  // Black one-pixel lines four apart on white: on 14 inner columns, the 4 lines
  // and the 6 columns beside them pass the Laplacian; the 7 beside them have a gradient of 1/2.
  const lines = styleStats(rgbaImage(16, 8, (x) => (x % 4 ? [255, 255, 255, 255] : [0, 0, 0, 255])));
  near(lines.fine, 10 / 14, 'fine');
  near(lines.gradient, 7 / 14 * 0.5 * lightnessOf(255), 'gradient');
  near(lines.bright, 12 / 16, 'bright');
  // A checkerboard of two tones: every 3 x 3 mean is 5/9 of the centre and 4/9 of the other.
  const board = (a, b) => styleStats(rgbaImage(10, 10, (x, y) => ((x + y) % 2 ? [a, a, a, 255] : [b, b, b, 255])));
  const light = board(230, 250), dark = board(20, 40);
  near(light.textureLight, (4 / 9) * (lightnessOf(250) - lightnessOf(230)), 'light texture');
  near(dark.textureDark, (4 / 9) * (lightnessOf(40) - lightnessOf(20)), 'dark texture');
  assert.deepEqual([light.textureDark, dark.textureLight], [null, null]);
});

test('contact sheet: styleStats holds no layout term, so a mirrored picture reads the same', () => {
  const tone = (x, y) => [(x * 37 + y * 11) % 256, (x * x + 3 * y) % 256, (x * y * 7) % 256, 255];
  const W = 23, H = 17, a = styleStats(rgbaImage(W, H, tone)), b = styleStats(rgbaImage(W, H, (x, y) => tone(W - 1 - x, H - 1 - y)));
  for (const k of ['colour', 'lightness']) assert.deepEqual(a[k], b[k], k);
  for (const k of ['pixels', 'chroma', 'bright', 'gradient', 'fine', 'textureLight', 'textureDark']) near(a[k], b[k], k, 1e-12);
});

test('contact sheet: styleStats skips transparent pixels, and lays a partly transparent one over white', () => {
  const orange = [0xc8, 0x64, 0x3c, 255];
  const half = styleStats(rgbaImage(8, 8, (x) => (x < 4 ? orange : [0, 0, 0, 0]))), alone = styleStats(rgbaImage(4, 8, () => orange));
  assert.equal(half.pixels, 32);
  assert.deepEqual(half.colour, alone.colour, 'the transparent margin is not white');
  assert.deepEqual(half.lightness, alone.lightness);
  near(half.chroma, alone.chroma, 'chroma');
  assert.equal(half.gradient, 0, 'no pixel beside the transparent margin is measured as an edge');
  const glazed = styleStats(rgbaImage(3, 3, () => [0, 0, 0, 128])), grey = styleStats(rgbaImage(3, 3, () => [127, 127, 127, 255]));
  near(glazed.lightness.indexOf(1), grey.lightness.indexOf(1), 'black at half alpha over white is mid grey', 0.5);
  near(glazed.chroma, grey.chroma, 'chroma', 1e-6);
});

test('contact sheet: styleGap reports each part and the colour bins that differ most, with no weight or total', () => {
  const X = [0xc8, 0x64, 0x3c, 255], Y = [0x20, 0x30, 0x90, 255];
  const ref = styleStats(rgbaImage(8, 8, () => X)), mixed = styleStats(rgbaImage(8, 8, (x) => (x < 4 ? X : Y)));
  const same = styleGap(ref, ref);
  assert.deepEqual([same.colour, same.lightness.gap, same.chroma.ratio, same.bins], [0, 0, 1, []], 'a crop against itself');
  assert.deepEqual(same.textureLight, { piece: null, reference: null, ratio: null });
  assert.deepEqual(same.fine, { piece: 0, reference: 0, ratio: null }, 'no ratio to a reference of 0');
  const gap = styleGap(ref, mixed);
  assert.equal(gap.colour, 0.5, 'half the pixels moved to another bin');
  assert.deepEqual(gap.pixels, { piece: 64, reference: 64 });
  near(gap.chroma.ratio, +((oklch('#c8643c')[1] + oklch('#203090')[1]) / 2 / oklch('#c8643c')[1]).toFixed(4), 'chroma ratio', 1e-12);
  assert.equal(gap.bins.length, 2);
  for (const [colour, piece, reference] of [['#c8643c', 0.5, 1], ['#203090', 0.5, 0]]) {
    const [L, C, h] = oklch(colour);
    const b = gap.bins.find((x) => Math.abs(x.L - L) <= 0.05 && Math.abs(x.a - C * Math.cos(h)) <= 0.03 && Math.abs(x.b - C * Math.sin(h)) <= 0.03);
    assert.ok(b, `a bin centred within half a step of ${colour}: ${JSON.stringify(gap.bins)}`);
    assert.deepEqual([b.piece, b.reference], [piece, reference], colour);
  }
  assert.deepEqual(Object.keys(gap), ['pixels', 'colour', 'lightness', 'chroma', 'gradient', 'fine', 'bright', 'textureLight', 'textureDark', 'bins'], 'style parts only');
  const empty = styleGap(styleStats(rgbaImage(2, 2, () => [0, 0, 0, 0])), ref);
  assert.deepEqual([empty.colour, empty.lightness.gap, empty.bins], [null, null, []], 'nothing to compare against an empty crop');
  const n = '[\\d.]+', p = '[\\d.]+%';
  assert.match(styleText(gap), new RegExp(`^colour 0\\.5 · lightness ${n} · chroma ${n} vs photo ${n} · gradient ${n} vs photo 0 · fine ${p} vs photo 0\\.0% · bright 0\\.0% vs photo 0\\.0%`
    + ' · light texture none vs photo none · dark texture none vs photo none · colours most apart, OKLab L a b: [-\\d. ]+ 50\\.0% vs photo (100\\.0|0\\.0)%, [-\\d. ]+ 50\\.0% vs photo (100\\.0|0\\.0)%$'));
});

// A 160 x 80 frame of paper with a blue disc of radius 15 centred at (cx, 40).
const discFrame = (cx, tone = () => 0) => rgbaImage(160, 80, (x, y) => (Math.hypot(x - cx, y - 40) < 15 ? [40, 70, 160, 255] : [250 - tone(x, y), 245 - tone(x, y), 235 - tone(x, y), 255]));

test('contact sheet: frameGap scores a shape shifted 20 px with the same colours clearly worse than one in place, where styleGap sees no gap', () => {
  const reference = discFrame(60), shifted = discFrame(80);
  const style = styleGap(styleStats(reference), styleStats(shifted));
  assert.deepEqual([style.colour, style.lightness.gap], [0, 0], 'the same colours in another place read as the same style');
  const same = frameGap(reference, discFrame(60));
  assert.deepEqual([same.mean, same.off, same.worst], [0, 0, null], 'a render in place');
  // Paper grain of up to 6 per channel moves the mean but leaves no pixel off.
  const grain = frameGap(reference, discFrame(60, (x, y) => (x * 7 + y * 13) % 7));
  assert.equal(grain.off, 0, 'grain under the threshold');
  assert.ok(grain.mean > 0 && grain.mean < 6, `grain mean ${grain.mean}`);
  const gap = frameGap(reference, shifted);
  assert.equal(FRAME_THRESHOLD, 32);
  assert.ok(gap.off > 0.05, `the two crescents a 20 px shift uncovers are off: ${gap.off}`);
  assert.ok(gap.mean > 5, `mean channel difference ${gap.mean}`);
  // The misses sit in the regions the disc moved across, 20 x 10 px each, and nowhere else.
  assert.deepEqual([gap.grid.cols, gap.grid.rows, gap.grid.off.length, gap.grid.off[0].length], [FRAME_GRID, FRAME_GRID, 8, 8]);
  gap.grid.off.forEach((row, r) => row.forEach((v, c) => {
    if (c < 2 || c > 4 || r < 2 || r > 5) assert.equal(v, 0, `region ${c}, ${r} is away from the disc`);
  }));
  const w = gap.worst;
  assert.ok(w.col >= 2 && w.col <= 4 && w.row >= 2 && w.row <= 5, JSON.stringify(w));
  assert.deepEqual([w.x, w.y, w.width, w.height, w.off], [w.col * 20, w.row * 10, 20, 10, gap.grid.off[w.row][w.col]]);
  const total = gap.grid.off.flat().reduce((s, v) => s + v * 200, 0);
  near(total / (160 * 80), gap.off, 'the regions hold every pixel off', 1e-3);
});

test('contact sheet: frameGap lays pixels over white, takes a threshold, bounds uneven regions and refuses two sizes', () => {
  const white = rgbaImage(4, 4, () => [255, 255, 255, 255]);
  assert.deepEqual([frameGap(rgbaImage(4, 4, () => [0, 0, 0, 0]), white).mean, frameGap(white, rgbaImage(4, 4, () => [0, 0, 0, 0])).off], [0, 0], 'transparent reads as white');
  const grey = rgbaImage(4, 4, () => [235, 235, 235, 255]);
  assert.deepEqual([frameGap(white, grey).mean, frameGap(white, grey).off, frameGap(white, grey, 10).off, frameGap(white, grey, 20).off], [20, 0, 1, 0], 'off is over the threshold, not at it');
  // 10 x 5 px in 8 x 5 regions: columns 2, 1, 1, 1, 2, 1, 1, 1 px wide.
  const one = frameGap(rgbaImage(10, 5, () => [255, 255, 255, 255]), rgbaImage(10, 5, (x, y) => (x === 6 && y === 3 ? [0, 0, 0, 255] : [255, 255, 255, 255])));
  assert.deepEqual([one.grid.cols, one.grid.rows, one.off], [8, 5, 0.02]);
  assert.deepEqual(one.worst, { col: 4, row: 3, x: 5, y: 3, width: 2, height: 1, off: 0.5 });
  assert.throws(() => frameGap(rgbaImage(8, 5, () => [0, 0, 0, 255]), rgbaImage(10, 5, () => [0, 0, 0, 255])),
    /^Error: seeds: the render is 10 x 5 px and the reference 8 x 5 px; the comparison is pixel by pixel at the same place and rescales nothing, so draw the render at the reference's size/);
  assert.deepEqual(frameText(one), [
    '10 x 5 px: mean channel difference 5.10 of 255; 2.0% of pixels off by more than 32', 'share off by region, 8 x 5, top row first:',
    ...[0, 0, 0, 1, 0].map((r) => [0, 0, 0, 0, r * 50, 0, 0, 0].map((v) => (v.toFixed(1) + '%').padStart(7)).join('')),
    'most off: column 5 of 8, row 4 of 5, pixels 5 to 6 across and 3 to 3 down: 50.0% off']);
});

// `image` as an 8-bit RGBA PNG file.
const pngBytes = ({ width, height, data }) => {
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0); out.write(type, 4, 'latin1'); body.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
  const rows = Array.from({ length: height }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.from(data.subarray(y * width * 4, (y + 1) * width * 4))]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
};

test('contact sheet: --compare prints the frame gap of two PNG files and refuses its other arguments', () => {
  assert.deepEqual(parseArgs(['--compare', 'a.png', 'b.PNG']), { compare: { render: 'a.png', reference: 'b.PNG' }, threshold: FRAME_THRESHOLD, json: false });
  assert.deepEqual(parseArgs(['--json', '--threshold', '0', '--compare', 'a.png', 'b.png']).threshold, 0);
  assert.equal(parseArgs(['--compare', 'a.png', 'b.png', '--threshold', '12.5']).threshold, 12.5);
  for (const [args, cause] of [
    [['--compare', 'a.png'], '--compare needs a render and a reference, two .png files, got a.png'],
    [['--compare', 'a.png', 'b.webp'], '--compare needs a render and a reference, two .png files, got a.png b.webp'],
    [['--compare', 'a.png', 'b.png', '--threshold', '255'], '--threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got 255'],
    [['--compare', 'a.png', 'b.png', '--threshold'], '--threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got nothing'],
    [['--compare', 'a.png', 'b.png', '--png'], '--compare takes only --threshold and --json beside its two files, got --png'],
    [['--compare', 'a.png', 'b.png', '--values'], '--compare takes only --threshold and --json beside its two files, got --values'],
    [['drift', '--compare', 'a.png', 'b.png'], '--compare takes only --threshold and --json beside its two files, got drift'],
  ]) assert.throws(() => parseArgs(args), (e) => e.message === `seeds: ${cause}\n${USAGE}`, args.join(' '));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-compare-'));
  try {
    const file = (name, image) => { fs.writeFileSync(path.join(dir, name), pngBytes(image)); return path.join(dir, name); };
    const ref = file('ref.png', discFrame(60)), render = file('render.png', discFrame(80)), small = file('small.png', rgbaImage(8, 8, () => [0, 0, 0, 255]));
    const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), '--compare', ...args], { encoding: 'utf8' });
    const text = run(render, ref);
    assert.equal(text.status, 0, text.stderr);
    const gap = frameGap(discFrame(60), discFrame(80));
    assert.equal(text.stdout, [`${render} against ${ref}, ${frameText(gap)[0]}`, ...frameText(gap).slice(1)].join('\n') + '\n');
    const json = run(render, ref, '--threshold', '100', '--json');
    assert.deepEqual(JSON.parse(json.stdout), frameGap(discFrame(60), discFrame(80), 100));
    const mismatch = run(small, ref);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /^seeds: the render is 8 x 8 px and the reference 160 x 80 px; .*, such as with npm --prefix "[^"]+" run still -- "<piece>" --scale "<k>", or crop the reference to the render's\n/);
    const missing = run(path.join(dir, 'none.png'), ref);
    assert.match(missing.stderr, /^seeds: --compare cannot read .*none\.png: ENOENT/);
    fs.writeFileSync(path.join(dir, 'fake.png'), 'not a png');
    assert.match(run(path.join(dir, 'fake.png'), ref).stderr, /^seeds: .*fake\.png is not a PNG file/);
    // A JPEG named .png: the advice names the file that is one, the render or the reference.
    fs.writeFileSync(path.join(dir, 'jpeg.png'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]));
    assert.match(run(path.join(dir, 'jpeg.png'), ref).stderr, /^seeds: .*jpeg\.png is a JPEG image; this tool reads PNG only, so save the render as PNG first/);
    assert.match(run(render, path.join(dir, 'jpeg.png')).stderr, /^seeds: .*jpeg\.png is a JPEG image; this tool reads PNG only, so save the reference as PNG first/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('contact sheet: a --reference strip measures each 100% crop against the decoded photo before it offers window.__sheet', async () => {
  // Small cells, so the stand-in's crops are quick to measure.
  const strip = { frames: 3, loupe: true, scale: 0.1 }, { w, h, W } = planStrip(validate(EXAMPLES.readout), strip).loupe;
  const cut = { w, h, name: 'photo.png', src: 'data:image/png;base64,CROP', at: null, x: 1, y: 1, scale: 1, sx: 0, sy: 0, sw: w, sh: h };
  const html = page(['readout'], 3, 1, [], null, null, strip, cut);
  assert.match(html, /<img id="reference-photo" src="data:image\/png;base64,CROP"/);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
  assert.doesNotMatch(page(['readout'], 3, 1, [], null, null, strip), /function styleStats/, 'a strip without a photo is unchanged');
  const { window, elements, draws, reads } = runStrip(strip, {}, 'readout', [], 3, null, cut);
  assert.equal(window.__sheet, undefined, 'the sheet waits for the photo to decode');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.__sheet.cells.length, 3);
  // The photo is drawn whole at its own size and read at that size.
  const photo = draws.filter((d) => d.args[0] && d.args[0].tag === 'reference-photo');
  assert.deepEqual(photo.map((d) => [d.canvas.width, d.canvas.height, ...d.args.slice(1)]), [[w, h, 0, 0]]);
  assert.deepEqual(reads.filter((r) => r.canvas === photo[0].canvas).map((r) => r.rect), [[0, 0, w, h]]);
  // Each crop is measured over white, cut from the film at the cell's own crop rectangle, and read whole.
  const isFilm = (d) => d.args[0] && d.args[0].tag === 'canvas' && d.args[0].width === W;
  // The measure canvas is the one read back that the film is drawn into; each shown crop is drawn into but never read.
  const measure = reads.map((r) => r.canvas).find((c) => draws.some((d) => d.canvas === c && isFilm(d)));
  const ops = draws.filter((d) => d.canvas === measure).map((d) => (d.fill !== undefined ? [d.fill, ...d.args] : [isFilm(d) ? 'film' : 'other', ...d.args.slice(1)]));
  assert.deepEqual(ops, JSON.parse(JSON.stringify(window.__sheet.cells.flatMap((cell) => [['#fff', 0, 0, w, h], ['film', cell.loupe.x, cell.loupe.y, w, h, 0, 0, w, h]]))));
  assert.deepEqual(reads.filter((r) => r.canvas === measure).map((r) => r.rect), Array(3).fill([0, 0, w, h]));
  // The stand-in canvases read back transparent pixels, so neither side has any to measure.
  for (const cell of window.__sheet.cells) assert.deepEqual(JSON.parse(JSON.stringify([cell.style.pixels, cell.style.colour])), [{ piece: 0, reference: 0 }, null]);
  assert.equal(elements.filter((el) => /^style gap from the photo: colour none · /.test(el.textContent || '')).length, 3, 'each crop is captioned with its gap');
});

test('contact sheet: a time strip takes one piece and --frames or --at, and --scale and --loupe need one', () => {
  for (const args of [
    ['readout', '--frames', '1'], ['readout', '--frames', '2.5'], ['readout', '--frames', '3', '--frames', '4'],
    ['readout', '--frames', '9', '--at', '1'], ['--frames', '9'], ['readout', '9', '--frames', '3'],
    ['readout', '--frames', '3', '--param', 'lead'], ['readout', '--at', '1,,2'], ['readout', '--at'],
    ['readout', '--scale', '2'], ['readout', '--loupe'], ['readout', '--frames', '3', '--scale', '0'],
  ]) assert.throws(() => parseArgs(args), /seeds/, args.join(' '));
  assert.equal(parseArgs(['drift', '9']).strip, undefined, 'a seed sheet is unchanged');
});

// An image `width` x `height` whose pixel (x, y) has grey level `grey(x, y)` and alpha `alpha`.
const greyImage = (width, height, grey, alpha = 255) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([grey(x, y), grey(x, y), grey(x, y), alpha], (y * width + x) * 4);
  }
  return { width, height, data };
};

test('contact sheet: a strip frame\'s detail is measured in blocks 1/80 of the cell wide, so fine hatching with no subject reads as flat', () => {
  assert.equal(frameDetail(greyImage(640, 320, () => 128)).detail, 0, 'a flat ground has no detail');
  // Lines two pixels apart change at every pixel, and every 8-pixel block holds the same share of them.
  const hatch = greyImage(640, 320, (x, y) => ((x + y) % 2 ? 20 : 235));
  assert.equal(frameDetail(hatch).detail, 0, 'bare hatching averages to one tone');
  const halves = frameDetail(greyImage(640, 320, (x) => (x < 320 ? 0 : 255)));
  assert.equal(halves.grid.length, 80 * 40);
  // One step of 255 in each of 40 rows, among 79 * 40 horizontal and 80 * 39 vertical steps.
  const expected = (255 * 40) / (79 * 40 + 80 * 39);
  assert.ok(Math.abs(halves.detail - expected) < 1e-9, String(halves.detail));
  assert.deepEqual(frameDetail(greyImage(160, 80, () => 0, 0)).grid.slice(0, 2), [255, 255], 'a transparent frame is the sheet\'s white');
});

test('contact sheet: a strip frame\'s detail and block grid are the same at any --scale, so the flags hold', () => {
  // A disc on a ground, the same design at a 480, 640 and 1920 pixel cell.
  const disc = (width) => greyImage(width, width / 2, (x, y) => (Math.hypot(x / width - 0.3, y / width - 0.25) < 0.12 ? 30 : 200));
  const at = [480, 640, 1920].map((width) => frameDetail(disc(width)));
  for (const d of at) {
    assert.equal(d.grid.length, 80 * 40, 'one 80 by 40 grid at every size');
    assert.ok(Math.abs(d.detail - at[1].detail) < 0.05 * at[1].detail, `detail ${d.detail} against ${at[1].detail} at 640`);
  }
  assert.ok(Math.abs(frameDetail(greyImage(1920, 960, (x) => (x < 960 ? 0 : 255))).detail - (255 * 40) / (79 * 40 + 80 * 39)) < 1e-9,
    'two halves step once a row at 1920 as at 640');
  assert.equal(gridChange([0, 10, 20], [0, 10, 23]), 1);
});

test('contact sheet: a strip flags a frame nearly empty under the floor or far under the most detailed frame on each side', () => {
  const R = STRIP_RULES;
  const cells = (details) => details.map((detail, i) => ({ frame: i * 10, seconds: i, t: i / 10, detail, error: null }));
  const lumas = (n) => Array.from({ length: n }, (_, i) => frameDetail(greyImage(16, 8, () => i * 10)).luma);
  const empty = (details) => stripFlags(cells(details), lumas(details.length), R).empty.map((e) => [e.frame, e.why]);
  assert.deepEqual(empty([5, 6, 5, 7]), [], 'steady detail reports nothing');
  assert.deepEqual(empty([5, 6, 0.5, 0.5, 7]), [[20, 'dip'], [30, 'dip']], 'a blank shown twice is still under both sides');
  assert.deepEqual(empty([5, 6, R.dip * 6, 7]), [], 'the share itself is not under it');
  assert.deepEqual(empty([0.05, 0.3, 1, 4, 5]), [], 'a film that opens from nothing and builds has no richer frame before it');
  assert.deepEqual(empty([5, 4, 0.3]), [], 'nor does one that fades out at its end');
  assert.deepEqual(empty([R.floor / 2, 5]), [[0, 'floor']], 'a flat frame is under the floor anywhere');
  const failed = cells([5, 0.5, 5]);
  failed[0].error = 'draw failed';
  assert.deepEqual(stripFlags(failed, lumas(3), R).empty, [], 'a failed cell is no side');
  assert.deepEqual(Object.keys(stripFlags(cells([5, 0.5, 5]), lumas(3), R).empty[0]), ['cell', 'frame', 'seconds', 't', 'detail', 'why'],
    'each names its cell, frame and playhead');
});

test('contact sheet: a strip reports frames held against the first of them for holdSeconds or more', () => {
  const R = STRIP_RULES;
  const run = (values, step = 1) => [values.map((_, i) => ({ frame: i, seconds: i * step, t: i, detail: 5, error: null })),
    values.map((v) => frameDetail(greyImage(160, 80, () => v)).luma)];
  const holds = (values, step) => stripFlags(...run(values, step), R).holds.map((h) => [h.from.frame, h.to.frame, h.seconds]);
  const still = [0, 50, 50, 50, 50, 50, 50, 50, 90];
  assert.deepEqual(holds(still), [[1, 7, 6]]);
  assert.deepEqual(holds(still.slice(0, 7)), [], 'five seconds held is not six');
  assert.deepEqual(holds([0, 1, 2, 3, 4, 5, 6, 7]), [], 'small steps that add up are not a hold');
  assert.deepEqual(holds([50, 50, 50, 50], 3), [[0, 3, 9]], 'judged by seconds, not by frames shown');
  const [cells, lumas] = run(still);
  stripFlags(cells, lumas, R);
  const hold = cells.map((cell) => cell.hold);
  assert.equal(hold[0], null, 'the first cell is not judged');
  assert.ok(hold[1] >= R.still && hold[8] >= R.still, `the cells that end a run hold ${hold[1]} and ${hold[8]}`);
  assert.deepEqual(hold.slice(2, 8), [0, 0, 0, 0, 0, 0], 'each held cell reports its change from the first of its run');
  cells[4].error = 'draw failed';
  assert.deepEqual(stripFlags(cells, lumas, R).holds, [], 'a failed cell breaks the run');
  assert.deepEqual([cells[4].hold, cells[5].hold], [null, null], 'a failed cell and the cell after it are not judged');
  const [shot, shotLumas] = run([50, 50, 50, 50], 6);
  ['a', 'a', 'b', 'b'].forEach((name, i) => { shot[i].shot = name; });
  assert.deepEqual(stripFlags(shot, shotLumas, R).holds.map((h) => [h.from.frame, h.to.frame, h.seconds]), [[0, 1, 6], [2, 3, 6]], 'a hold never spans a cut');
  assert.deepEqual(shot.map((cell) => cell.hold), [null, 0, null, 0], 'a cell that opens a shot is not judged');
});

test('contact sheet: a hold that breathes in one small region is not held, and a frozen one is, under grain, weave and flicker too', () => {
  const R = STRIP_RULES;
  const cells = Array.from({ length: 9 }, (_, i) => ({ frame: i * 12, seconds: i, t: i / 8, detail: 5, error: null }));
  const holds = (frames) => stripFlags(cells, frames.map((f) => f.luma), R).holds.map((h) => [h.from.frame, h.to.frame, h.seconds]);
  // The largest mean block change over regions of 8 by 8 blocks, with no shift allowed.
  const regionChange = (a, b) => {
    let most = 0;
    for (let ry = 0; ry < 40; ry += 8) {
      for (let rx = 0; rx < 80; rx += 8) {
        let total = 0;
        for (let y = ry; y < ry + 8; y++) for (let x = rx; x < rx + 8; x++) total += Math.abs(a.grid[y * 80 + x] - b.grid[y * 80 + x]);
        most = Math.max(most, total / 64);
      }
    }
    return most;
  };
  // A figure in a held pose: a disc on a still ground whose radius swells and
  // settles by two pixels a frame, so only the blocks on its edge change.
  const radii = [30, 32, 34, 32, 30, 32, 34, 32, 30];
  const breathing = radii.map((r) => frameDetail(greyImage(640, 320, (x, y) => (Math.hypot(x - 320, y - 160) < r ? 40 : 200))));
  assert.ok(gridChange(breathing[0].grid, breathing[2].grid) < R.still, 'over the whole frame the breath averages under the hold\'s threshold');
  assert.deepEqual(holds(breathing), [], 'a breathing hold is not held');
  assert.deepEqual(holds(radii.map(() => breathing[0])), [[0, 96, 8]], 'a frozen hold is');
  // Grain: every pixel moves by up to 10 a frame, seeded, so single blocks
  // differ by more than the threshold.
  let seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648) * 20 - 10; };
  const grainy = radii.map(() => frameDetail(greyImage(640, 320, (x, y) => (Math.hypot(x - 320, y - 160) < 30 ? 40 : 200) + noise())));
  assert.ok(grainy.slice(1).some((f) => f.grid.some((v, j) => Math.abs(v - grainy[0].grid[j]) >= R.still)), 'some block passes the threshold');
  assert.deepEqual(holds(grainy), [[0, 96, 8]], 'a frozen hold under grain is held');
  // Flicker: the whole frame darkened by up to the deepest flicker, 2.5%,
  // which moves a paper ground by about 6.
  const dips = [0, 0.025, 0.01, 0.02, 0, 0.025, 0.015, 0.005, 0.02];
  const lit = (r, dip) => frameDetail(greyImage(640, 320, (x, y) => (Math.hypot(x - 320, y - 160) < r ? 40 : 233) * (1 - dip)));
  const flickered = dips.map((dip) => lit(30, dip));
  assert.ok(Math.max(...flickered.map((f) => regionChange(flickered[0], f))) >= 2 * R.still, 'a flickered frame changes some region by twice the threshold');
  assert.deepEqual(holds(flickered), [[0, 96, 8]], 'a frozen hold under flicker is held');
  assert.deepEqual(holds(dips.map((dip, i) => lit(radii[i], dip))), [], 'a breathing hold under flicker is not held');
  // Weave: a black disc and a grid of lines on white, drawn with its edges
  // smoothed and moved as a whole by under a pixel each frame, which changes
  // every block holding an edge.
  const offsets = [[0, 0], [0.8, 0.4], [-0.8, -0.4], [0.5, -0.3], [-0.6, 0.4], [0.8, -0.4], [-0.3, 0.2], [0.7, 0.4], [-0.8, 0.1]];
  const ink = (x, y, r) => Math.hypot(x - 160, y - 160) < r
    || (x > 380 && x < 530 && y > 80 && y < 240 && ((x - 380) % 24 < 3 || (y - 80) % 24 < 3));
  const drawn = (dx, dy, r = 60) => frameDetail(greyImage(640, 320, (x, y) => {
    let n = 0;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) n += ink(x + (i + 0.5) / 2 - dx, y + (j + 0.5) / 2 - dy, r);
    return 255 - (n * 255) / 4;
  }));
  const woven = offsets.map(([dx, dy]) => drawn(dx, dy));
  assert.ok(Math.max(...woven.map((f) => regionChange(woven[0], f))) >= 2 * R.still, 'a woven frame changes some region by twice the threshold');
  assert.deepEqual(holds(woven), [[0, 96, 8]], 'a frozen hold under weave is held');
  assert.deepEqual(holds(offsets.map(([dx, dy], i) => drawn(dx, dy, 60 + radii[i] - 30))), [], 'a breathing hold under weave is not held');
  // The same grid off whole pixels, by 0.37 in design units, in exact area
  // coverage as Edge fills a rectangle, at 640 and 960 pixels: its smoothed
  // edges no longer match the bilinear shift, unless both frames are blurred.
  const cover = (lo, hi, a, b) => Math.max(0, Math.min(hi, b) - Math.max(lo, a));
  const lines = (lo, hi, a, b) => { let c = 0; for (let v = lo; v < hi; v += 24) c += cover(v, v + 3, a, b); return c; };
  const offGrid = (width, dx, dy, r = 60) => {
    const k = width / 640, o = 0.37;
    return frameDetail(greyImage(width, width / 2, (x, y) => {
      const a = x / k - dx, b = (x + 1) / k - dx, c = y / k - dy, d = (y + 1) / k - dy;
      const vx = lines(380 + o, 530 + o, a, b) * k, bx = cover(380 + o, 530 + o, a, b) * k;
      const hy = lines(80 + o, 240 + o, c, d) * k, by = cover(80 + o, 240 + o, c, d) * k;
      let n = 0;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) n += Math.hypot((x + (i + 0.5) / 2) / k - dx - 160, (y + (j + 0.5) / 2) / k - dy - 160) < r;
      return 255 - 255 * (vx * by + bx * hy - vx * hy + n / 4);
    }));
  };
  for (const width of [640, 960]) {
    assert.deepEqual(holds(offsets.map(([dx, dy]) => offGrid(width, dx, dy))), [[0, 96, 8]], `a frozen grid off whole pixels under weave is held at ${width} pixels`);
  }
  assert.deepEqual(holds(offsets.map(([dx, dy], i) => offGrid(640, dx, dy, 60 + radii[i] - 30))), [], 'a breathing hold beside the grid off whole pixels is not held');
});

test('contact sheet: a strip moves each frame it compares a bounded number of times, with the holds and flags it gave before', () => {
  // A disc and still lines on a grey ground, the disc off by under a pixel and
  // the frame dimmed by a flicker each frame, then moved and swollen in frame 7.
  const offsets = [[0, 0], [0.3, 0], [-0.3, 0.2], [0, -0.3], [0.2, 0.2], [0, 0], [-0.3, 0], [3, -1], [0, 1]];
  const dips = [0, 0.025, 0.01, 0.02, 0, 0.025, 0.015, 0.005, 0.02];
  const frames = offsets.map(([dx, dy], i) => frameDetail(greyImage(640, 320, (x, y) =>
    (Math.hypot(x - 160 - dx, y - 160 - dy) < 60 + (i > 6 ? 8 : 0) || (x % 24 < 3 && x > 380 && x < 530) ? 40 : 220) * (1 - dips[i]))));
  const cells = frames.map((f, i) => ({ frame: i, seconds: i, t: i / 8, detail: f.detail, error: null }));
  // Each bilinear sample of a moved frame floors its coordinates, so the
  // floors count the samples: about 42 a luma square per comparison when each
  // Lucas-Kanade step, gain fit and block sum sampled the frame again, and 6
  // when the first step sampled it unmoved and a step that left the shift
  // where it was sampled it again.
  const floor = Math.floor, F64 = Float64Array;
  let floors = 0, buffers = 0;
  Math.floor = (v) => { floors++; return floor(v); };
  // Each Float64Array made: 9 a frame for its blur and 2 a comparison when
  // every blur pass and comparison made its own.
  globalThis.Float64Array = class extends F64 { constructor(...args) { super(...args); buffers++; } };
  let flags;
  try { flags = stripFlags(cells, frames.map((f) => f.luma), STRIP_RULES); } finally { Math.floor = floor; globalThis.Float64Array = F64; }
  const { w, h } = frames[0].luma, perSquare = floors / (w * h) / (cells.length - 1);
  assert.ok(perSquare < 5.5, `${perSquare.toFixed(2)} floors a luma square per comparison`);
  assert.ok(buffers <= cells.length + 2, `${buffers} buffers for ${cells.length} frames`);
  assert.deepEqual(flags.holds.map((x) => [x.from.frame, x.to.frame, x.seconds]), [[0, 6, 6]]);
  assert.deepEqual(flags.empty, []);
  // Each cell's change from the first of its run, as the measure gave it before.
  const before = [null, 1.0643196781644495, 1.148111821509679, 0.4709375357787953, 0.9039745245818278, 0.09036551800744519, 1.2456093365059386, 32.00361159823028, 7.982402350756433];
  cells.forEach((cell, i) => assert.ok(before[i] === null ? cell.hold === null : Math.abs(cell.hold - before[i]) < 1e-9, `cell ${i} holds ${cell.hold}, not ${before[i]}`));
});

test('contact sheet: litArea follows a dim light moving across a dark ground and holds still under drift, flicker, weave and grain, where the whole-frame change cannot tell them apart', () => {
  let seed = 11;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648) * 12 - 6; };
  const glow = (x, y, cx, cy) => 40 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 50 * 50));
  const moves = (lit) => lit.slice(1).map((a, i) => Math.hypot(a.x - lit[i].x, a.y - lit[i].y));
  const changes = (frames) => frames.slice(1).map((f, i) => gridChange(frames[i].grid, f.grid));
  // A soft glow on a dark grainy ground, its centre moving 60 pixels a frame.
  const centres = [200, 260, 320, 380, 440];
  const moving = centres.map((cx) => frameDetail(greyImage(640, 320, (x, y) => 20 + glow(x, y, cx, 160) + noise())));
  const movingLit = moving.map(litArea);
  movingLit.forEach((a, i) => assert.ok(Math.hypot(a.x - centres[i], a.y - 160) <= 8, `frame ${i} centre ${a.x.toFixed(1)}, ${a.y.toFixed(1)} is within a block of ${centres[i]}, 160`));
  for (const m of moves(movingLit)) assert.ok(Math.abs(m - 60) <= 8, `a moving light moves ${m.toFixed(2)}, about 60`);
  // The same glow held still while the ground brightens 3 a frame, a flicker
  // dims the frame by up to 2.5%, a weave offsets it by under a pixel and the
  // grain changes every frame.
  const dips = [0, 0.025, 0.01, 0.02, 0];
  const offsets = [[0, 0], [0.8, 0.4], [-0.8, -0.4], [0.5, -0.3], [-0.6, 0.4]];
  const drift = dips.map((dip, i) => frameDetail(greyImage(640, 320, (x, y) => (20 + 3 * i + glow(x, y, 320 + offsets[i][0], 160 + offsets[i][1]) + noise()) * (1 - dip))));
  const driftLit = drift.map(litArea);
  driftLit.forEach((a, i) => assert.ok(Math.hypot(a.x - driftLit[0].x, a.y - driftLit[0].y) <= 2, `drift frame ${i} centre stays within 2 pixels of the first`));
  const driftMove = Math.max(...moves(driftLit));
  assert.ok(driftMove < 2, `drift moves the centre ${driftMove.toFixed(2)}`);
  // The whole-frame change of the drift reaches the moving light's, while the centre's move separates them.
  assert.ok(Math.max(...changes(drift)) >= Math.min(...changes(moving)), 'the whole-frame change cannot tell drift from a moving light');
  assert.ok(Math.min(...moves(movingLit)) > 10 * driftMove, 'the lit area\'s move tells them apart');
  // A lamp switched off: the level falls by more than 5 times.
  const off = litArea(frameDetail(greyImage(640, 320, () => 20 + noise())));
  assert.ok(movingLit[0].level > 5 * off.level, `level ${movingLit[0].level.toFixed(2)} then ${off.level.toFixed(2)}`);
  assert.equal(litArea(frameDetail(greyImage(160, 80, () => 90))), null, 'a flat frame has no lit area');
  assert.equal(litArea(frameDetail(greyImage(160, 80, () => 0, 0))), null, 'a white frame has none');
});

test('contact sheet: litArea mixes a static lit area into one centre and level, so a lamp switching off beside a brighter static area keeps most of the level', () => {
  // 8-pixel blocks, 80 x 40 of them on a ground of 10. A static area of 16 x 10
  // blocks at 210 (rise 200) at the top left, centre (64, 40); a lamp of 16 x 10
  // blocks at 50 (rise 40) lower right, centre (544, 240). Each is 5% of the blocks.
  const inBlocks = (x, y, bx, by) => x >= bx * 8 && x < (bx + 16) * 8 && y >= by * 8 && y < (by + 10) * 8;
  const frame = (still, lamp) => litArea(frameDetail(greyImage(640, 320, (x, y) => (still && inBlocks(x, y, 0, 0) ? 210 : lamp && inBlocks(x, y, 60, 25) ? 50 : 10))));
  const on = frame(true, true), off = frame(true, false);
  // Level (160 * 200 + 160 * 40) / 3200 = 12 with the lamp on, 160 * 200 / 3200 = 10 off.
  near(on.level, 12, 'level with the lamp on', 1e-6);
  near(off.level, 10, 'level with the lamp off', 1e-6);
  assert.ok(off.level / on.level > 0.75, `the switch keeps ${(off.level / on.level).toFixed(3)} of the level, above the 3/4 check`);
  // The lamp alone switching off leaves a flat frame: no lit area, a level of 0.
  assert.ok(frame(false, true).level > 0);
  assert.equal(frame(false, false), null, 'the lamp alone is caught');
  // The centre with the lamp on sits 40 / 240 of the way from the static area to the lamp.
  const reach = Math.hypot(544 - 64, 240 - 40);
  near(Math.hypot(on.x - 64, on.y - 40), reach / 6, 'the centre is pulled toward the static area', 1e-6);
  near(Math.hypot(off.x - 64, off.y - 40), 0, 'with the lamp off, the centre is the static area', 1e-6);
});

test('contact sheet: a strip\'s light flag judges each run of one shot by its lowest and highest level and largest move, broken at a shot\'s first cell and a failed cell', () => {
  const R = STRIP_RULES;
  // Cells and lumas of 640 x 320 frames, each cell's light measured as the
  // strip page measures it, at scale 1.
  const strip = (frames, { first = [], failed = [] } = {}) => {
    const ds = frames.map((f) => frameDetail(f));
    const cells = ds.map((d, i) => ({ frame: i, seconds: i, t: i, detail: d.detail, error: failed.includes(i) ? 'draw failed' : null, mark: first.includes(i) ? 'first' : undefined }));
    cells.forEach((cell, i) => {
      const lit = litArea(ds[i]), last = cells[i - 1], before = last && !last.error && cell.mark !== 'first' && last.light;
      cell.light = lit && { x: lit.x, y: lit.y, level: lit.level, move: before ? Math.hypot(lit.x - before.x, lit.y - before.y) : null, step: before ? lit.level - before.level : null };
    });
    return [cells, ds.map((d) => d.luma)];
  };
  const judge = (frames, options) => stripFlags(...strip(frames, options), R, 640).lights;
  const on = greyImage(640, 320, (x, y) => (Math.hypot(x - 320, y - 160) < 40 ? 230 : 10));
  const off = greyImage(640, 320, () => 10);
  const back = judge([on, off, on]);
  assert.deepEqual(back.map((l) => [l.from.frame, l.to.frame, l.low, l.held]), [[0, 2, 0, false]], 'on, off, on: a null light counts as 0, though first and last match');
  assert.deepEqual(judge([on]), [], 'a run of one cell is not judged');
  assert.deepEqual(judge([on, on, on, on, on], { failed: [2] }).map((l) => [l.from.frame, l.to.frame, l.held]), [[0, 1, true], [3, 4, true]], 'a failed cell splits the runs');
  assert.deepEqual(judge([on, on, off, on], { first: [2] }).map((l) => [l.from.frame, l.to.frame, l.held]), [[0, 1, true], [2, 3, false]], 'a cell marked first opens a run');
  const [bare, flat] = strip([off, off, off]);
  bare.forEach((cell) => delete cell.light);
  assert.deepEqual(stripFlags(bare, flat, R, 640).lights.map((l) => [l.move, l.high, l.dim, l.held]), [[null, 0, null, true]], 'cells with no light key on a flat ground hold');
  // The thresholds themselves, on hand-set lights over a flat ground.
  const hand = (lights) => stripFlags(lights.map((light, i) => ({ frame: i, seconds: i, t: i, detail: 5, error: null, light })), flat, R, 640).lights[0].held;
  assert.equal(hand([{ x: 0, y: 0, level: 4 }, { x: R.lightMove * 640, y: 0, level: 4 }, { x: 0, y: 0, level: 4 }]), false, 'a move of the share itself counts');
  assert.equal(hand([{ x: 0, y: 0, level: 4 }, { x: R.lightMove * 640 - 0.01, y: 0, level: 4 }, { x: 0, y: 0, level: 4 }]), true);
  assert.equal(hand([{ x: 0, y: 0, level: 4 }, { x: 0, y: 0, level: 4 * R.lightLevel }, { x: 0, y: 0, level: 4 }]), false, 'a lowest level at the share itself counts');
  assert.equal(hand([{ x: 0, y: 0, level: 4 }, { x: 0, y: 0, level: 4 * R.lightLevel + 0.01 }, { x: 0, y: 0, level: 4 }]), true);
  // The frames of the litArea test: a soft glow held while the ground drifts
  // under flicker, weave and grain holds its light, region by region too.
  let seed = 11;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648) * 12 - 6; };
  const glow = (x, y, cx, cy) => 40 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 50 * 50));
  const dips = [0, 0.025, 0.01, 0.02, 0];
  const offsets = [[0, 0], [0.8, 0.4], [-0.8, -0.4], [0.5, -0.3], [-0.6, 0.4]];
  const drift = dips.map((dip, i) => greyImage(640, 320, (x, y) => (20 + 3 * i + glow(x, y, 320 + offsets[i][0], 160 + offsets[i][1]) + noise()) * (1 - dip)));
  const [held] = judge(drift);
  assert.ok(held.held, `drift, flicker, weave and grain hold: ${JSON.stringify(held)}`);
  assert.ok(held.dim === null || held.dim > R.lightLevel, `no region dims: ${held.dim}`);
});

// Runs readout's strip page against stand-in elements, which keep their tag and
// children, and canvases that record each draw, fill and read and read back
// transparent pixels.
// A `reference` photo decodes at once. `paint(width, height)`, when given,
// returns the RGBA bytes every read-back returns instead.
// `takes(colour)`, when given, says whether the stand-in canvases take a colour; one they do not leaves the style set before it, as a browser's does.
const runStrip = (strip, globals = {}, name = 'readout', paramNames = [], count = 3, external = null, reference = null, box = null, views = null, paint = null, soundReference = null, planned = null, takes = null) => {
  const script = [...page([].concat(name), count, 1, paramNames, external, box, strip, reference, null, views, soundReference, false, planned).matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const reads = [], cells = [], elements = [], draws = [];
  const element = (tag) => {
    const el = { tag, children: [], style: { setProperty() {} }, setAttribute() {}, appendChild(child) { el.children.push(child); }, decode: async () => {} };
    elements.push(el);
    return el;
  };
  const canvas = () => Object.assign(element('canvas'), {
    width: 300, height: 150,
    getContext(type, options) {
      const g = Object.assign(nullSurface({ w: this.width, h: this.height }), { canvas: this, drawImage: (...args) => draws.push({ canvas: this, args }), fillText() {} });
      g.fillRect = (...args) => draws.push({ canvas: this, fill: g.fillStyle, args });
      g.getImageData = (x, y, w, h) => {
        reads.push({ canvas: this, options, rect: [x, y, w, h] });
        return { width: w, height: h, data: paint ? paint(w, h, this) : new Uint8ClampedArray(w * h * 4) };
      };
      if (takes) for (const key of ['fillStyle', 'strokeStyle']) {
        let kept = g[key];
        Object.defineProperty(g, key, { get: () => kept, set: (s) => { if (takes(s)) kept = s; }, configurable: true });
      }
      return g;
    },
  });
  const document = {
    getElementById: element, createTextNode: element, querySelectorAll: () => [],
    createElement: (tag) => { const el = tag === 'canvas' ? canvas() : element(tag); if (tag === 'canvas') cells.push(el); return el; },
  };
  const window = {};
  // The page's globals, its bundle's module cache (__cache) among them.
  const context = { document, window, performance, Uint8ClampedArray, console, ...globals };
  vm.runInNewContext(script, context);
  return { window, reads, cells, elements, draws, context };
};

test('contact sheet: a --param cell label shows the value rounded, while the piece gets the sampled value', () => {
  const p = validate(EXAMPLES.drift);
  const sampled = planSheet(p, 4, ['strokes']).map((cell) => cell.params.strokes);
  assert.equal(sampled[2], 180, 'a whole-number span samples whole values');
  const { elements } = runStrip(null, {}, 'drift', ['strokes'], 4);
  const labels = elements.filter((el) => el.className === 'values').map((el) => el.textContent);
  assert.deepEqual(labels, ['strokes=20', 'strokes=100', 'strokes=180', 'strokes=260']);
});

// refit declares a reframe timeline that ends in a square box; --box replaces
// that timeline, so its sheet and every cell are at the box, never 1280 x 720.
test('contact sheet: --box draws a piece that declares reframe at that box, not along its own timeline', () => {
  const box = { w: 405, h: 720 };
  assert.ok(EXAMPLES.refit.reframe, 'refit declares a box timeline');
  const p = atBox(validate(EXAMPLES.refit), box);
  assert.deepEqual([p.size, p.reframe], [box, null]);
  assert.deepEqual(solve(p, 1).state.box, box, 'the piece is built for the box');
  const { elements, cells } = runStrip(null, {}, 'refit', [], 2, null, null, box);
  const note = elements.find((el) => el.className === 'note');
  assert.match(note.textContent, /^405 × 720 · /, 'the sheet header names the box');
  // The first canvas is the page's one-pixel memory canvas; the cells follow.
  assert.deepEqual(cells.slice(1, 3).map((c) => [c.width, c.height]), [[480, 853], [480, 853]], 'each cell is drawn at the box');
});

test('contact sheet: sweepLabels names each sampled value, keeps samples apart and shows no residue', () => {
  const sweep = (min, max, count) => sweepLabels(
    planSheet({ seed: 1, params: { k: { min, max } } }, count, ['k']).map((cell) => cell.params.k), count);
  const cases = [
    [1, 6, 6, ['1', '2', '3', '4', '5', '6']],
    [0, 1, 4, ['0', '0.3333', '0.6667', '1']],
    [10000, 12345, 2, ['10000', '12345']],
    [10000, 50000, 5, ['10000', '20000', '30000', '40000', '50000']],
    [1000, 1001, 5, ['1000', '1000.25', '1000.5', '1000.75', '1001']],
    [-3, 7, 11, ['-3', '-2', '-1', '0', '1', '2', '3', '4', '5', '6', '7']],
    [-0.2, 0.1, 4, ['-0.2', '-0.1', '0', '0.1']],
    [0.125, 0.875, 3, ['0.125', '0.5', '0.875']],
    [1e-9, 2e-9, 3, ['1e-9', '1.5e-9', '2e-9']],
    [5, 5, 3, ['5', '5', '5']],
  ];
  for (const [min, max, count, want] of cases) {
    const got = sweep(min, max, count);
    assert.deepEqual(got, want, `${min}..${max} at ${count}`);
    if (min !== max) assert.equal(new Set(got).size, count, `${min}..${max} at ${count} keeps distinct labels`);
  }
});

test('contact sheet: --param labels trim float noise only, keeping every real digit', () => {
  const knob = EXAMPLES.drift.params.strokes, was = { ...knob };
  const labelsFor = (min, max, count) => {
    Object.assign(knob, { min, max, value: min });
    try {
      return runStrip(null, {}, 'drift', ['strokes'], count).elements
        .filter((el) => el.className === 'values').map((el) => el.textContent);
    } finally { Object.assign(knob, was); }
  };
  assert.deepEqual(labelsFor(1, 6, 6), ['strokes=1', 'strokes=2', 'strokes=3', 'strokes=4', 'strokes=5', 'strokes=6']);
  assert.deepEqual(labelsFor(10000, 12345, 2), ['strokes=10000', 'strokes=12345']);
  assert.deepEqual(labelsFor(1000, 1001, 5), ['strokes=1000', 'strokes=1000.25', 'strokes=1000.5', 'strokes=1000.75', 'strokes=1001']);
  assert.deepEqual(labelsFor(-0.2, 0.1, 4), ['strokes=-0.2', 'strokes=-0.1', 'strokes=0', 'strokes=0.1']);
});

test('contact sheet: --seed draws a time strip or a still at that seed, names it after the seed, and is refused where it means nothing', () => {
  const frames = parseArgs(['readout', '--frames', '3', '--seed', '7']).strip;
  assert.equal(frames.seed, 7);
  assert.equal(parseArgs(['specimen', '--at', '0', '--seed', '0']).strip.seed, 0, 'a still takes seed 0');
  assert.equal(parseArgs(['readout', '--frames', '3']).strip.seed, undefined, 'without --seed the strip is unchanged');
  const p = validate(EXAMPLES.readout);
  assert.notEqual(p.seed, 7, 'the test needs a seed other than the piece\'s own');
  const layout = planStrip(p, frames);
  assert.ok(layout.cells.every((cell) => cell.seed === 7) && layout.seed === 7);
  assert.ok(planStrip(p, { frames: 3 }).cells.every((cell) => cell.seed === p.seed), 'without --seed the piece\'s own seed');
  const stem = (strip) => path.basename(sheetStem(['readout'], [], null, null, strip));
  assert.equal(stem(frames), 'readout-frames-seed7');
  assert.equal(stem({ at: [0], seed: 0, sound: true }), 'readout-at-seed0-sound');
  assert.equal(stem({ shots: true, seed: 18 }), 'readout-shots-seed18');
  assert.notEqual(stem({ frames: 3, seed: 9 }), stem(frames), 'strips at two seeds keep separate files');
  const { window, elements } = runStrip(frames);
  assert.ok(window.__sheet.cells.every((cell) => cell.seed === 7), 'each cell is drawn at the seed');
  assert.ok(elements.some((el) => / at seed 7, /.test(el.textContent || '')), 'the note names the seed drawn');
  assert.throws(() => parseArgs(['readout', '9', '--seed', '7']), /--seed picks the seed of a time strip, a still or a one-name parameter sweep; a contact sheet already sweeps seeds 1 to its count, so add --frames, --at, --shots or --contacts, or drop --seed/);
  assert.deepEqual(parseArgs(['readout', '3', '--param', 'reach', '--seed', '7']).seeds, [7]);
  for (const bad of ['-1', '1.5', 'x', '4294967296']) {
    assert.throws(() => parseArgs(['readout', '--frames', '3', '--seed', bad]), /--seed takes a whole number from 0 to 4294967295/, bad);
  }
  assert.throws(() => parseArgs(['readout', '--frames', '3', '--seed']), /--seed takes a whole number .*got nothing/);
  assert.throws(() => parseArgs(['readout', '--frames', '3', '--seed', '1', '--seed', '2']), /use --seed only once/);
});

test('contact sheet: a strip times each draw without reading its cell, which would move a GPU canvas to the CPU', () => {
  const { window, reads, cells } = runStrip({ frames: 3 });
  assert.equal(window.__sheet.cells.length, 3);
  assert.ok(window.__sheet.cells.every((cell) => cell.error === null && cell.drawMs >= 0), 'every cell is drawn and timed');
  const frames = new Set(cells.filter((c) => c.width === 640));
  assert.equal(frames.size, 3, 'three 640 px cells');
  for (const cell of frames) {
    // Only the metrics read the cell, once, after the frame it shows is drawn:
    // its bounds and its detail share that read, each about 3.5 ms in Edge.
    assert.equal(reads.filter((r) => r.canvas === cell).length, 1, 'a cell is read once, for its metrics');
  }
  assert.ok(reads.filter((r) => !frames.has(r.canvas)).every((r) => r.options && r.options.willReadFrequently),
    'the timed draws are forced through a memory canvas');
  assert.equal(reads.filter((r) => !frames.has(r.canvas)).length, 9, 'three timed draws per cell, each forced');
});

test('contact sheet: in a browser the page logs the piece modules\' load, the piece\'s setup, each cell\'s build and draw, the strip\'s flags and the results, then runs each in a task of its own', async () => {
  const { SHEET_PROGRESS } = require('../tools/check-browser.js');
  const logged = [];
  const { window, context } = runStrip({ frames: 3 }, { MessageChannel, console: { debug: (text) => logged.push(text) } });
  // The first script ends before the piece modules even load, so Node hears of each stage before it can stall.
  assert.equal(window.__sheet, undefined, 'no stage runs in the first script');
  assert.equal(context.__cache['examples/index.js'], undefined, 'the piece modules load in a stage, not in the first script');
  assert.deepEqual(logged, [SHEET_PROGRESS + 'piece module load']);
  for (let wait = 0; !window.__sheet && wait < 200; wait++) await new Promise((resolve) => setTimeout(resolve, 5));
  // The third cell opens the rest shot, and its label says so.
  const plan = [...window.__sheet.cells].map((cell, i) => 'readout cell ' + (i + 1) + ' of 3 (' + (i === 2 ? 'rest, shot start · ' : '') + 'frame ' + cell.frame + ' · ' + cell.seconds.toFixed(3) + ' s)');
  // The cells share one seed, so only the first builds the piece.
  assert.deepEqual(logged, ['piece module load', 'piece setup of readout', 'piece build of ' + plan[0], ...plan.map((where) => 'frame draw of ' + where),
    'strip flags of readout', 'sheet results'].map((stage) => SHEET_PROGRESS + stage));
  const sync = runStrip({ frames: 3 }).window.__sheet;
  const fields = (sheet) => JSON.stringify({ cells: sheet.cells.map((cell) => [cell.error, cell.markCount, cell.detail, cell.change]), flags: sheet.flags });
  assert.equal(fields(window.__sheet), fields(sync), 'the cells and flags match those drawn in one script');
});

test('contact sheet: cells at one seed and params share one build, timed once, so a piece whose build is its film is solved once a strip', async () => {
  const builds = async (...args) => {
    const { window, context } = runStrip(...args);
    // The first script yields before any build, so each solve after it is counted.
    const P = context.__cache['core/piece.js'].exports, solve = P.solve;
    let count = 0;
    P.solve = (...a) => { count++; return solve(...a); };
    for (let wait = 0; !window.__sheet && wait < 400; wait++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(window.__sheet, 'the sheet finished');
    return { count, cells: [...window.__sheet.cells], sound: window.__sheet.sound };
  };
  const strip = await builds({ frames: 4, seed: 7 }, { MessageChannel });
  assert.equal(strip.cells.length, 4);
  assert.ok(strip.cells.every((cell) => cell.error === null), 'every cell is drawn');
  assert.equal(strip.count, 1, `a strip of 4 cells at one seed solves its piece ${strip.count} times`);
  assert.deepEqual(strip.cells.map((cell) => typeof cell.buildMs), ['number', 'object', 'object', 'object'], 'the build time is reported once, on the cell that built it');
  // A --sound strip renders its soundtrack from the strip's build, not a second solve.
  const { Context } = fakeAudio();
  const sound = await builds({ frames: 4, seed: 7, sound: true }, { MessageChannel, OfflineAudioContext: Context, Promise, Float32Array, Float64Array, Math });
  assert.equal(sound.sound.error, null, 'the soundtrack is drawn');
  assert.equal(sound.count, 1, `a --sound strip of 4 cells at one seed solves its piece ${sound.count} times`);
  assert.deepEqual(sound.cells.map((cell) => typeof cell.buildMs), ['number', 'object', 'object', 'object'], 'the build time is still reported once');
  const sweep = await builds(null, { MessageChannel }, 'drift', ['strokes'], 3);
  assert.equal(sweep.count, 3, 'a sweep builds each value');
  assert.ok(sweep.cells.every((cell) => cell.buildMs >= 0));
});

test('contact sheet: in a browser the page yields after every stage it logs, and runs that stage only in the next task', () => {
  // A stand-in channel delivers each message only when the test turns it, one task at a time.
  let pending = null, clock = 0;
  function MessageChannel() {
    const port1 = { onmessage: null, close() {} };
    this.port1 = port1;
    this.port2 = { postMessage: () => { pending = port1.onmessage; } };
  }
  const logged = [], snapshots = [];
  let strip = null; // the first script logs before runStrip returns, when nothing has run
  // What the stages have done so far: loaded the piece modules, timed, read, made elements, finished the sheet.
  const work = () => strip
    ? { modules: !!strip.context.__cache['examples/index.js'], now: clock, reads: strip.reads.length, elements: strip.elements.length, done: !!strip.window.__sheet }
    : { modules: false, now: clock, reads: 0, elements: 0, done: false };
  const debug = (text) => { logged.push(text); snapshots.push(work()); };
  const performance = { now: () => clock++ };
  strip = runStrip({ frames: 3 }, { MessageChannel, performance, console: { debug } });
  const { window } = strip;
  assert.equal(logged.length, 1, 'the first script logs one stage and yields');
  assert.equal(work().modules, false, 'the first script loads no piece module');
  // The piece modules' load, the piece's setup, one build and three draws, the strip's flags and the results.
  const stages = 8;
  for (let turn = 1; turn <= stages; turn++) {
    assert.ok(pending, 'turn ' + turn + ' has a task waiting');
    const run = pending;
    pending = null;
    run();
    const before = snapshots[turn - 1];
    if (turn === stages) {
      assert.equal(logged.length, stages, 'the last turn logs nothing more');
      assert.ok(!before.done && work().done, 'the results are written in the last turn');
      break;
    }
    assert.equal(logged.length, turn + 1, 'turn ' + turn + ' logs exactly one more stage');
    assert.notDeepEqual(snapshots[turn], before, 'turn ' + turn + ' runs the stage logged before it');
    assert.deepEqual(work(), snapshots[turn], 'turn ' + turn + ' yields right after logging, before the stage it logged runs');
  }
  assert.ok(window.__sheet, 'the sheet finished');
  assert.equal(pending, null, 'nothing waits after the sheet');
});

test('contact sheet: in a browser a seed sheet names each cell by its seed, and a --param sweep by its value', async () => {
  const { SHEET_PROGRESS } = require('../tools/check-browser.js');
  const logs = async (paramNames, count) => {
    const logged = [];
    const { window } = runStrip(null, { MessageChannel, console: { debug: (text) => logged.push(text) } }, 'drift', paramNames, count);
    for (let wait = 0; !window.__sheet && wait < 400; wait++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(window.__sheet, 'the sheet finished');
    return { logged, cells: window.__sheet.cells };
  };
  const stages = (labels) => ['piece module load', 'piece setup of drift', ...[...labels].flatMap((label, i) => ['piece build of ', 'frame draw of ']
    .map((stage) => stage + 'drift cell ' + (i + 1) + ' of ' + labels.length + ' (' + label + ')')), 'sheet results'].map((stage) => SHEET_PROGRESS + stage);
  const seeds = await logs([], 2);
  assert.equal(new Set(seeds.cells.map((cell) => cell.seed)).size, 2, 'two seeds');
  assert.deepEqual(seeds.logged, stages(seeds.cells.map((cell) => 'seed ' + cell.seed)));
  const sweep = await logs(['strokes'], 4);
  assert.deepEqual(sweep.logged, stages(['strokes=20', 'strokes=100', 'strokes=180', 'strokes=260']));
  // A sheet of two pieces sets up each just before its own cells.
  const logged = [];
  const { window } = runStrip(null, { MessageChannel, console: { debug: (text) => logged.push(text) } }, ['drift', 'readout'], [], 1);
  for (let wait = 0; !window.__sheet && wait < 400; wait++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(logged.map((text) => text.slice(SHEET_PROGRESS.length).replace(/ cell 1 of 1 \(.*\)$/, '')), [
    'piece module load', 'piece setup of drift', 'piece build of drift', 'frame draw of drift',
    'piece setup of readout', 'piece build of readout', 'frame draw of readout', 'sheet results',
  ]);
});

test('contact sheet: a strip writes each flag under its own cell, even when two cells show one frame', () => {
  // Transparent read-backs are the sheet's white, so every cell is under the floor.
  const { window, elements } = runStrip({ at: [2, 2, 4] });
  assert.deepEqual(Array.from(window.__sheet.flags.empty, (e) => [e.cell, e.frame, e.why]), [[0, 48, 'floor'], [1, 48, 'floor'], [2, 96, 'floor']]);
  const captions = elements.filter((el) => el.tag === 'figcaption');
  assert.equal(captions.length, 3);
  assert.deepEqual(captions.map((cap) => cap.children.filter((child) => child.className === 'flag').length), [1, 1, 1]);
  assert.deepEqual(Array.from(window.__sheet.cells, (cell) => cell.hold), [null, 0, 0], 'each cell reports its hold measure beside its change');
  // Each caption's stats line shows the change and hold it reports, and the first cell, measured against no frame, neither.
  const stats = captions.map((cap) => cap.children[1].textContent);
  assert.ok(!/change|hold/.test(stats[0]), stats[0]);
  for (const line of stats.slice(1)) assert.match(line, / · detail 0\.00 · change 0\.00 · hold 0\.00$/);
  assert.deepEqual(Array.from(window.__sheet.cells, (cell) => cell.light), [null, null, null], 'a white frame has no lit area');
});

test('contact sheet: a strip reports each cell\'s lit area in design units, and how far it moved since the previous cell', () => {
  // Each cell's full-size reads are a near-black ground with a bright disc, 0.3 of the cell's width further right each cell.
  const order = new Map();
  const paint = (w, h, canvas) => {
    const d = new Uint8ClampedArray(w * h * 4);
    if (w * h === 1) return d;
    if (!order.has(canvas)) order.set(canvas, order.size);
    const cx = (0.15 + 0.3 * order.get(canvas)) * w, cy = h / 2, r = 0.06 * w;
    for (let i = 0; i < w * h; i++) {
      const v = Math.hypot(i % w - cx, Math.floor(i / w) - cy) < r ? 230 : 10;
      d.fill(v, 4 * i, 4 * i + 3);
      d[4 * i + 3] = 255;
    }
    return d;
  };
  const { window } = runStrip({ frames: 3 }, {}, 'readout', [], 3, null, null, null, null, paint);
  const lights = JSON.parse(JSON.stringify(window.__sheet.cells)).map((cell) => cell.light);
  const { w } = validate(EXAMPLES.readout).size;
  for (const light of lights) for (const key of ['x', 'y', 'level']) assert.equal(typeof light[key], 'number', `${key} of ${JSON.stringify(light)}`);
  assert.deepEqual([lights[0].move, lights[0].step], [null, null], 'the first cell has no previous light');
  assert.ok(Math.abs(lights[1].move - 0.3 * w) <= w / 40, `the light moved ${lights[1].move}, about ${0.3 * w}`);
  assert.ok(Math.abs(lights[1].step) < 1, `its level held: ${lights[1].step}`);
});

test('contact sheet: a --shots strip does not compare the light of a cell that opens a shot with the shot before it', () => {
  // Two shots whose lights hold still, the first's at the left, the second's at the right.
  const order = new Map();
  const paint = (w, h, canvas) => {
    const d = new Uint8ClampedArray(w * h * 4);
    if (w * h === 1) return d;
    if (!order.has(canvas)) order.set(canvas, order.size);
    const cx = (order.get(canvas) < 3 ? 0.2 : 0.8) * w, cy = h / 2, r = 0.06 * w;
    for (let i = 0; i < w * h; i++) {
      const v = Math.hypot(i % w - cx, Math.floor(i / w) - cy) < r ? 230 : 10;
      d.fill(v, 4 * i, 4 * i + 3);
      d[4 * i + 3] = 255;
    }
    return d;
  };
  const { window } = runStrip({ shots: true }, {}, 'readout', [], 3, null, null, null, null, paint);
  const cells = JSON.parse(JSON.stringify(window.__sheet.cells));
  assert.deepEqual(cells.map((cell) => cell.mark), ['first', 'middle', 'last', 'first', 'middle', 'last']);
  const { w } = validate(EXAMPLES.readout).size;
  cells.forEach((cell, i) => {
    if (cell.mark === 'first') assert.deepEqual([cell.light.move, cell.light.step], [null, null], `cell ${i} opens a shot`);
    else assert.ok(cell.light.move < 0.01 * w, `cell ${i}'s light held still: ${cell.light.move}`);
  });
});

test('contact sheet: on fixtures/light-film.cjs a --shots strip reports the light held only in its drift shot, counting a null light as 0 and catching a small lamp beside a brighter static area by its region', () => {
  const fixture = loadExternal(path.join(__dirname, 'fixtures', 'light-film.cjs'));
  const p = validate(fixture.piece), plan = planStrip(p, { shots: true }), { state } = solve(p, p.seed);
  assert.equal(plan.scale, 1, 'a 640-wide cell paints the fixture pixel for pixel');
  // Each cell canvas, numbered by its first read, gets the fixture's frame
  // painted from its whole-pixel grey rectangles.
  const order = new Map();
  const paint = (w, h, canvas) => {
    const d = new Uint8ClampedArray(w * h * 4);
    if (w * h === 1) return d;
    if (!order.has(canvas)) order.set(canvas, order.size);
    const cell = plan.cells[order.get(canvas)];
    const g = {
      fillStyle: '#000',
      fillRect(x, y, rw, rh) {
        const v = Number(/^rgb\((\d+), \1, \1\)$/.exec(this.fillStyle)[1]);
        for (let yy = Math.max(0, y); yy < Math.min(h, y + rh); yy++) {
          for (let xx = Math.max(0, x); xx < Math.min(w, x + rw); xx++) d.set([v, v, v, 255], (yy * w + xx) * 4);
        }
      },
    };
    fixture.piece.draw(g, state, cell.t, { frame: cell.frame, seconds: cell.seconds });
    return d;
  };
  const { window, elements } = runStrip({ shots: true }, {}, 'light-film', [], 0, fixture, null, null, null, paint);
  const sheet = JSON.parse(JSON.stringify(window.__sheet)), lights = sheet.flags.lights;
  const captions = elements.filter((el) => el.tag === 'figcaption');
  assert.deepEqual(captions.flatMap((cap, i) => cap.children.filter((child) => child.className === 'light-held').map((child) => [i, child.textContent])),
    [[5, 'light held in drift: no move of 6.4 design units or more, and no level or lit region falling to 75% of its highest']], 'the sheet writes the held light under the run\'s last cell');
  assert.match(elements.find((el) => el.tag === 'p' && /among the frames shown/.test(el.textContent)).textContent, /light held in 1 of 7 runs/);
  // Steady light is a shot's normal state: on a strip with no empty frame and
  // no hold, a lamp held still in each shot leaves the report unflagged.
  const still = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    if (w * h === 1) return d;
    for (let i = 0; i < w * h; i++) {
      const v = Math.hypot(i % w - w / 2, Math.floor(i / w) - h / 2) < 0.06 * w ? 230 : 10;
      d.fill(v, 4 * i, 4 * i + 3);
      d[4 * i + 3] = 255;
    }
    return d;
  };
  const steady = runStrip({ frames: 3 }, {}, 'readout', [], 3, null, null, null, null, still);
  const flags = JSON.parse(JSON.stringify(steady.window.__sheet.flags));
  assert.deepEqual([flags.empty.length, flags.holds.length, flags.lights.map((l) => l.held)], [0, 0, [true]]);
  const report = steady.elements.find((el) => el.tag === 'p' && /among the frames shown/.test(el.textContent));
  assert.equal(report.className, 'note', report.textContent);
  assert.deepEqual(lights.map((l) => [l.shot, l.held]), [['sweep', false], ['drift', true], ['rise', false], ['switch', false], ['pan', false], ['dilute', false], ['creep', false]]);
  const by = Object.fromEntries(lights.map((l) => [l.shot, l]));
  // The slow drift: each step between its cells stays under the share, first to last reaches it, and its level holds.
  const { creep } = by, share = STRIP_RULES.lightMove * 640;
  assert.ok(creep.move >= share && creep.low > STRIP_RULES.lightLevel * creep.high && (creep.dim === null || creep.dim > STRIP_RULES.lightLevel),
    `the slow drift is judged by its move alone: ${JSON.stringify(creep)}`);
  assert.deepEqual([19, 20].map((i) => sheet.cells[i].light.move < share), [true, true], `each step: ${sheet.cells[19].light.move}, ${sheet.cells[20].light.move}`);
  assert.equal(sheet.cells[10].light, null, 'the switch shot\'s middle cell has no light');
  assert.equal(by.switch.low, 0, 'and counts at level 0');
  const { dilute, pan } = by;
  assert.ok(dilute.low > STRIP_RULES.lightLevel * dilute.high && dilute.move < STRIP_RULES.lightMove * 640,
    `the small lamp keeps the frame's level (${dilute.low} of ${dilute.high}) and barely moves the centre (${dilute.move})`);
  assert.ok(dilute.dim !== null && dilute.dim <= STRIP_RULES.lightLevel, `its region dims: ${dilute.dim}`);
  assert.ok(Math.abs(pan.move - 8 * 35) <= 1, `a pan of 8 units a frame, frames 144 to 179, reads as a moving light: ${pan.move}`);
});

// skills/artifex/reference/materials.md (one light plan): `--param key,lift`
// at count 9 draws key across in steps of 45 degrees and lift down in steps of
// 22.5 degrees, and key 0.25 lights the right of the frame.
test('contact sheet: on fixtures/key-lift.cjs --param key,lift at count 9 draws the documented grid, key 0.25 lights the right side, key 0 is brighter than key 0.5, key 0.125 is brighter than key 0.375 and lift 0.25 lights the top', () => {
  const fixture = loadExternal(path.join(__dirname, 'fixtures', 'key-lift.cjs'));
  const p = validate(fixture.piece);
  const cells = planSheet(p, 9, ['key', 'lift']);
  assert.equal(cells.length, 81);
  const columns = cells.slice(0, 9).map((cell) => cell.params.key * 360);
  const rows = cells.filter((_, i) => i % 9 === 0).map((cell) => cell.params.lift * 360);
  assert.deepEqual(columns, [0, 45, 90, 135, 180, 225, 270, 315, 360], 'key columns 45 degrees apart, the first and last one angle');
  assert.deepEqual(rows, [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90], 'lift rows 22.5 degrees apart, level and 45 degrees above and below included');
  assert.ok(cells.every((cell, i) => cell.params.key === cells[i % 9].params.key && cell.params.lift === cells[i - (i % 9)].params.lift), 'key across, lift down');
  const { elements } = runStrip(null, {}, 'key-lift', ['key', 'lift'], 9, fixture);
  assert.equal(elements.filter((el) => el.className === 'values').length, 81, 'the page draws every cell');
  // Paint the fixture's grey blocks and compare the mean of each half of the frame.
  const halves = (params) => {
    const { w, h } = p.size, d = new Float64Array(w * h);
    const g = {
      fillStyle: '#000',
      fillRect(x, y, rw, rh) {
        const v = Number(/^rgb\((\d+), \1, \1\)$/.exec(this.fillStyle)[1]);
        for (let yy = y; yy < y + rh; yy++) d.fill(v, yy * w + x, yy * w + x + rw);
      },
    };
    fixture.piece.draw(g, solve(p, p.seed, { ...params }).state, 0, { frame: 0, seconds: 0 });
    let left = 0, right = 0, top = 0, bottom = 0;
    d.forEach((v, i) => {
      if (i % w < w / 2) left += v; else right += v;
      if (i < w * h / 2) top += v; else bottom += v;
    });
    return { left, right, top, bottom };
  };
  const right = halves({ key: 0.25, lift: 0 }), left = halves({ key: 0.75, lift: 0 }), front = halves({ key: 0, lift: 0 });
  assert.ok(right.right > 1.5 * right.left, `key 0.25 lights the right: left ${right.left}, right ${right.right}`);
  assert.ok(left.left > 1.5 * left.right, `key 0.75 lights the left: left ${left.left}, right ${left.right}`);
  assert.ok(Math.abs(front.left - front.right) < 0.05 * front.left, `key 0 lights both halves alike: left ${front.left}, right ${front.right}`);
  // Direction, not only symmetry: key 0 is at the camera, so it lights the sphere
  // far more than key 0.5 behind it, and lift 0.25 lights the top half more than the bottom.
  const sum = (m) => m.left + m.right;
  const behind = halves({ key: 0.5, lift: 0 }), up = halves({ key: 0, lift: 0.25 });
  assert.ok(sum(front) > 2 * sum(behind), `key 0 lights the sphere more than key 0.5: ${sum(front)} against ${sum(behind)}`);
  const near = halves({ key: 0.125, lift: 0 }), far = halves({ key: 0.375, lift: 0 });
  assert.ok(sum(near) > sum(far), `key 0.125 lights the sphere more than key 0.375: ${sum(near)} against ${sum(far)}`);
  assert.ok(up.top > 1.5 * up.bottom, `lift 0.25 lights the top half more than the bottom: top ${up.top}, bottom ${up.bottom}`);
});

test('contact sheet: a strip\'s light flag judges a run\'s move by the largest distance between two of its lights, so a slow drift sampled densely and a swing about its first light are not held', () => {
  const R = STRIP_RULES;
  // Cells and lumas of 640 x 320 frames, each cell's light measured as the strip page measures it, at scale 1.
  const judge = (frames) => {
    const ds = frames.map((f) => frameDetail(f));
    const cells = ds.map((d, i) => ({ frame: i, seconds: i, t: i, detail: d.detail, error: null }));
    cells.forEach((cell, i) => {
      const lit = litArea(ds[i]), before = cells[i - 1] && cells[i - 1].light;
      cell.light = lit && { x: lit.x, y: lit.y, level: lit.level, move: before ? Math.hypot(lit.x - before.x, lit.y - before.y) : null, step: before ? lit.level - before.level : null };
    });
    return stripFlags(cells, ds.map((d) => d.luma), R, 640).lights;
  };
  // A soft pool of light, its rise 12 out to 30 units and falling evenly to 0
  // at 150, so moving it 15 units dims no region to 3/4 of its brightest.
  const disc = (cx) => greyImage(640, 320, (x, y) => 10 + Math.round(12 * Math.max(0, Math.min(1, (150 - Math.hypot(x - cx, y - 160)) / 120))));
  // A lamp drifting 1 unit a frame: 15 units over 16 cells, no step between two of them reaching 6.4.
  const dense = judge(Array.from({ length: 16 }, (_, i) => disc(320 + i)));
  assert.equal(dense.length, 1);
  assert.equal(dense[0].held, false, `a slow drift over 16 cells moves ${dense[0].move}`);
  assert.ok(dense[0].move >= R.lightMove * 640, `move ${dense[0].move}`);
  assert.equal(judge([disc(320), disc(335)])[0].held, false, 'the same drift over 2 cells');
  // Out and back: the farthest cell from the first counts, though first and last match.
  const flat = frameDetail(greyImage(640, 320, () => 10)).luma;
  const hand = (xs) => stripFlags(xs.map((x, i) => ({ frame: i, seconds: i, t: i, detail: 5, error: null, light: { x, y: 0, level: 4 } })),
    xs.map(() => flat), R, 640).lights;
  assert.equal(hand([0, 3.3, 6.6, 3.3, 0])[0].held, false);
  // A swing about the first light: no light lies 6.4 from it, but the two ends lie 6.6 apart.
  const swing = hand([0, 3.3, 0, -3.3, 0])[0];
  assert.deepEqual([swing.move, swing.held], [6.6, false], 'a swing reads its full width');
  assert.equal(hand([0, 0.1 + 0.2])[0].move, 0.3, 'the move is rounded to 2 decimals');
});

test('contact sheet: a --contacts strip breaks change and hold at each contact\'s row, and its light at a cut inside a row', (t) => {
  // Rows of contacts on frames 0, 10 and 23: frames 0 to 3, 8 to 13 and 21 to 23.
  const ends = runStrip({ contacts: 'ends', scale: 0.1 }, {}, 'touching', [], 0, touchingExternal());
  const cells = JSON.parse(JSON.stringify(ends.window.__sheet.cells));
  assert.deepEqual(cells.map((cell) => cell.frame), [0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 21, 22, 23]);
  const opens = [0, 4, 10];
  cells.forEach((cell, i) => {
    if (opens.includes(i)) assert.deepEqual([cell.change, cell.hold], [null, null], `cell ${i} opens a contact's row`);
    else assert.ok(typeof cell.change === 'number' && typeof cell.hold === 'number', `cell ${i}: ${cell.change}, ${cell.hold}`);
  });
  // stripFlags by itself: two rows of flat frames 6 s long each are two holds.
  const flat = frameDetail(greyImage(640, 320, () => 10)).luma;
  const rows = [1, 1, 2, 2].map((contact, i) => ({ frame: i, seconds: i * 6, t: i, detail: 5, error: null, contact }));
  const flags = stripFlags(rows, rows.map(() => flat), STRIP_RULES, 640);
  assert.deepEqual(flags.holds.map((h) => [h.from.cell, h.to.cell, h.seconds]), [[0, 1, 6], [2, 3, 6]]);
  assert.deepEqual(rows.map((cell) => cell.hold), [null, 0, null, 0]);
  // A contact whose row crosses a cut: its light is judged in each shot apart.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-light-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'light-contact.cjs');
  fs.writeFileSync(file, "module.exports = { name: 'light-contact', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
    + " build: [['shots', (s) => { s.cues = { shots: [{ name: 'a', start: 0, end: 10 }, { name: 'b', start: 10, end: 20 }] }; s.touch = [{ frame: 10 }]; }]],"
    + ' draw(g) { g.fillRect(0, 0, 100, 50); } };\n');
  const order = new Map();
  const paint = (w, h, canvas) => {
    const d = new Uint8ClampedArray(w * h * 4);
    if (w * h === 1) return d;
    if (!order.has(canvas)) order.set(canvas, order.size);
    const cx = (order.get(canvas) < 2 ? 0.2 : 0.8) * w, cy = h / 2, r = 0.06 * w;
    for (let i = 0; i < w * h; i++) {
      const v = Math.hypot(i % w - cx, Math.floor(i / w) - cy) < r ? 230 : 10;
      d.fill(v, 4 * i, 4 * i + 3);
      d[4 * i + 3] = 255;
    }
    return d;
  };
  const { window, elements } = runStrip({ contacts: 'touch' }, {}, 'light-contact', [], 0, loadExternal(file), null, null, null, paint);
  const cut = JSON.parse(JSON.stringify(window.__sheet));
  assert.deepEqual(cut.cells.map((cell) => [cell.frame, cell.shot]), [[8, 'a'], [9, 'a'], [10, 'b'], [11, 'b'], [12, 'b'], [13, 'b']]);
  assert.deepEqual([cut.cells[2].change, cut.cells[2].light.move], [null, null], 'the cell after the cut is not compared across it');
  assert.deepEqual(cut.flags.lights.map((l) => [l.from.frame, l.to.frame, l.shot, l.held]), [[8, 9, 'a', true], [10, 13, 'b', true]]);
  // The cell that opens shot b inside contact 1's row says why it shows no change.
  const labels = elements.filter((el) => el.className === 'values').map((el) => el.textContent);
  assert.match(labels[2], /^contact 1 · b, shot start · frame 10 · 1\.000 s$/);
  assert.deepEqual(labels.map((l) => l.includes('shot start')), [false, false, true, false, false, false]);
  const rowLabels = ends.elements.filter((el) => el.className === 'values').map((el) => el.textContent);
  assert.deepEqual(opens.map((i) => rowLabels[i].includes('shot start')), [false, false, false], 'a cell that opens a contact\'s row is no shot start');
});

test('contact sheet: a --frames or --at cell that opens a shot is captioned as a shot start', () => {
  const labels = (strip) => runStrip(strip, {}, 'readout').elements.filter((el) => el.className === 'values').map((el) => el.textContent);
  const at = labels({ at: [5.5, 5.9, 6, 6.5] });
  assert.match(at[2], /^rest, shot start · frame 144 · 6\.000 s$/);
  assert.deepEqual(at.map((l) => l.includes('shot start')), [false, false, true, false]);
  const frames = labels({ frames: 3 });
  assert.match(frames[2], /^rest, shot start · frame 167 · /);
  assert.ok(!frames[0].includes('shot start'), 'the first cell opens no shot after another');
});

test('contact sheet: a strip does not compare the light of a cell that follows a failed cell, or that opens a shot whose name the shot before shares', (t) => {
  // Two shots, the first's light at the left, the second's at the right; two shots
  // named alike are refused. The loupe draw of frame 14, on the film canvas wider
  // than the 640-pixel cell, throws.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-light-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (second) => {
    const file = path.join(dir, `light-fail-${second}.cjs`);
    fs.writeFileSync(file, "module.exports = { name: 'light-fail', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
      + ` build: [['shots', (s) => { s.cues = { shots: [{ name: 'a', start: 0, end: 10 }, { name: '${second}', start: 10, end: 20 }] }; }]],`
      + " draw(g, state, t, clock) { if (g.canvas && g.canvas.width > 640 && clock.frame === 14) throw new Error('loupe draw failed'); g.fillRect(0, 0, 100, 50); } };\n");
    return file;
  };
  assert.throws(() => planStrip(validate(loadExternal(write('a')).piece), { shots: true, loupe: true }),
    { message: `seeds: state.cues.shots entry [1] is a second shot named a in light-fail; give each shot its own name, as shots() does\n${USAGE}` });
  const file = write('b');
  const plan = planStrip(validate(loadExternal(file).piece), { shots: true, loupe: true });
  assert.ok(plan.width === 640 && plan.loupe.W > 640, 'only the loupe draws wider than the cell');
  const order = new Map();
  const paint = (w, h, canvas) => {
    const d = new Uint8ClampedArray(w * h * 4);
    if (w * h === 1) return d;
    if (!order.has(canvas)) order.set(canvas, order.size);
    const cx = (order.get(canvas) < 3 ? 0.2 : 0.8) * w, cy = h / 2, r = 0.06 * w;
    for (let i = 0; i < w * h; i++) {
      const v = Math.hypot(i % w - cx, Math.floor(i / w) - cy) < r ? 230 : 10;
      d.fill(v, 4 * i, 4 * i + 3);
      d[4 * i + 3] = 255;
    }
    return d;
  };
  const { window } = runStrip({ shots: true, loupe: true }, {}, 'light-fail', [], 0, loadExternal(file), null, null, null, paint);
  const cells = JSON.parse(JSON.stringify(window.__sheet.cells));
  assert.deepEqual(cells.map((cell) => [cell.frame, cell.mark]), [[0, 'first'], [4, 'middle'], [9, 'last'], [10, 'first'], [14, 'middle'], [19, 'last']]);
  assert.match(String(cells[4].error), /loupe draw failed/);
  assert.equal(typeof cells[4].light.x, 'number', 'the failed cell measured its light before the loupe threw');
  assert.deepEqual([cells[3].light.move, cells[3].light.step, cells[3].change], [null, null, null], 'a cell marked first opens a shot');
  assert.deepEqual([cells[4].change, cells[4].light.move, cells[4].light.step], [null, null, null], 'a failed cell is not judged');
  assert.deepEqual([cells[5].light.move, cells[5].light.step, cells[5].change], [null, null, null], 'a cell after a failed cell is not compared with it');
  for (const i of [1, 2]) assert.ok(cells[i].light.move < 1, `cell ${i}'s light held still: ${cells[i].light.move}`);
});

test('contact sheet: a strip cell whose draw throws before its frame is measured still carries a null change', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-early-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'early-fail.cjs');
  fs.writeFileSync(file, "module.exports = { name: 'early-fail', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
    + " draw(g, state, t, clock) { if (clock.frame === 10) throw new Error('draw failed'); g.fillRect(0, 0, 100, 50); } };\n");
  const { window } = runStrip({ frames: 3 }, {}, 'early-fail', [], 0, loadExternal(file));
  const cells = JSON.parse(JSON.stringify(window.__sheet.cells));
  assert.deepEqual(cells.map((cell) => cell.frame), [0, 10, 19]);
  assert.match(String(cells[1].error), /draw failed/);
  assert.deepEqual([cells[1].change, cells[2].change], [null, null], 'the failed cell and the cell after it');
});

test('contact sheet: a strip cell that fails after its frame is drawn counts no change in any beat, nor does the cell after it', (t) => {
  // Frames 0, 4, 8, 11, 15 and 19; the loupe draw of frame 8, wider than the 640-pixel cell, throws.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-late-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'late-fail.cjs');
  fs.writeFileSync(file, "module.exports = { name: 'late-fail', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
    + " build: [['plan', (s) => { s.cues = { beats: [{ frame: 0, intensity: 0.2 }, { frame: 10, intensity: 1 }] }; }]],"
    + " draw(g, state, t, clock) { if (g.canvas && g.canvas.width > 640 && clock.frame === 8) throw new Error('loupe draw failed'); g.fillRect(0, 0, 100, 50); } };\n");
  const order = new Map();
  // A bright disc that moves right on each canvas the page reads.
  const paint = (w, h, canvas) => {
    const d = new Uint8ClampedArray(w * h * 4);
    if (w * h === 1) return d;
    if (!order.has(canvas)) order.set(canvas, order.size);
    const cx = (0.1 + 0.1 * (order.get(canvas) % 8)) * w, cy = h / 2, r = 0.06 * w;
    for (let i = 0; i < w * h; i++) {
      d.fill(Math.hypot(i % w - cx, Math.floor(i / w) - cy) < r ? 230 : 10, 4 * i, 4 * i + 3);
      d[4 * i + 3] = 255;
    }
    return d;
  };
  const { window } = runStrip({ frames: 6, loupe: true }, {}, 'late-fail', [], 0, loadExternal(file), null, null, null, paint);
  const sheet = JSON.parse(JSON.stringify(window.__sheet)), cells = sheet.cells;
  assert.deepEqual(cells.map((cell) => cell.frame), [0, 4, 8, 11, 15, 19]);
  assert.match(String(cells[2].error), /loupe draw failed/);
  assert.equal(typeof cells[2].detail, 'number', 'the failed cell measured its frame before the loupe threw');
  assert.deepEqual([cells[2].change, cells[3].change, cells[3].hold], [null, null, null], 'the failed cell and the cell after it');
  // Beat 0 keeps the change at 4; beat 1 those at 15 and 19.
  assert.deepEqual(sheet.beats.map((b) => b.cells), [1, 2]);
});

test('contact sheet: strip cells carry the shot their frame falls in whenever the piece keeps a shot list', () => {
  const readout = validate(EXAMPLES.readout);
  const tag = (strip) => planStrip(readout, strip).cells.map((c) => [c.frame, c.shot]);
  assert.deepEqual(tag({ frames: 3 }), [[0, 'read'], [84, 'read'], [167, 'rest']]);
  assert.deepEqual(tag({ at: [5.9, 6] }), [[141, 'read'], [144, 'rest']], 'a cut between two --at cells');
  assert.deepEqual(tag({ shots: true }).map(([, shot]) => shot), ['read', 'read', 'read', 'rest', 'rest', 'rest']);
  assert.ok(planStrip(validate(EXAMPLES.cascade), { frames: 3 }).cells.every((c) => !('shot' in c)), 'a piece with no shot list tags nothing');
});

test('contact sheet: a --frames or --at strip Edge draws skips the Node build, and its page tags the same shots, labels, stages and results', async () => {
  const readout = validate(EXAMPLES.readout);
  let built = 0;
  const counted = { ...readout, build: [...readout.build, ['count', () => { built++; }]] };
  const inPage = planStrip(counted, { frames: 3 }, true);
  assert.equal(built, 0, 'no Node build for a page that tags its own shots');
  assert.ok(inPage.pageShots && inPage.cells.every((c) => !('shot' in c)));
  for (const strip of [{ shots: true }, { frames: 3, sound: true }]) {
    assert.equal(planStrip(readout, strip, true).pageShots, undefined, JSON.stringify(strip));
  }
  assert.equal(planStrip(readout, { frames: 3 }).pageShots, undefined, 'a strip no page draws keeps its build');
  // seeds main passes drawsInPage(args): --png and --json draw the page in Edge, a plain run only writes it.
  const drawn = (...flags) => drawsInPage(parseArgs(['readout', '--frames', '3', ...flags]));
  assert.deepEqual([drawn('--png'), drawn('--json'), drawn('--png', '--json'), drawn()], [true, true, true, false]);
  // Each run's sheet as JSON with its timings reduced to their type, its labels and its logged stages.
  const run = async (name, strip, planned) => {
    const logged = [];
    const { window, elements } = runStrip(strip, { MessageChannel, console: { debug: (text) => logged.push(text) } }, name, [], 3, null, null, null, null, null, null, planned);
    for (let wait = 0; !window.__sheet && wait < 400; wait++) await new Promise((resolve) => setTimeout(resolve, 5));
    const sheet = JSON.parse(JSON.stringify(window.__sheet));
    sheet.cells = sheet.cells.map(({ buildMs, drawMs, viewMs, ...cell }) => ({ ...cell, timed: [buildMs, drawMs, viewMs].map((ms) => (ms === null ? null : typeof ms)) }));
    return { sheet, logged, labels: elements.filter((el) => el.className === 'values').map((el) => el.textContent) };
  };
  for (const [name, strip] of [['readout', { frames: 9 }], ['readout', { at: [5.9, 6, 6.5] }], ['cascade', { frames: 3 }]]) {
    const node = await run(name, strip, null), page = await run(name, strip, planStrip(validate(EXAMPLES[name]), strip, true));
    assert.deepEqual(page, node, `${name} ${JSON.stringify(strip)}`);
  }
  const cut = await run('readout', { at: [5.9, 6] }, planStrip(readout, { at: [5.9, 6] }, true));
  assert.deepEqual(cut.sheet.cells.map((c) => c.shot), ['read', 'rest']);
  assert.match(cut.labels[1], /^rest, shot start · /, 'the page breaks the run at the cut it tagged');
});

test('contact sheet: a --frames strip of a piece whose state() throws plans its cells and writes its page, so the page draws them failed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-state-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state-fail.cjs');
  fs.writeFileSync(file, "module.exports = { name: 'state-fail', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
    + " state() { throw new Error('state boom'); }, draw(g) { g.fillRect(0, 0, 100, 50); } };\n");
  const external = loadExternal(file);
  assert.deepEqual(planStrip(validate(external.piece), { frames: 3 }).cells.map((c) => [c.frame, 'shot' in c]), [[0, false], [10, false], [19, false]]);
  const cells = JSON.parse(JSON.stringify(runStrip({ frames: 3 }, {}, 'state-fail', [], 0, external).window.__sheet.cells));
  assert.deepEqual(cells.map((c) => [c.frame, /state boom/.test(String(c.error))]), [[0, true], [10, true], [19, true]]);
  // A strip that needs the built state refuses by the piece's name, as for a failed stage.
  for (const strip of [{ shots: true }, { frames: 3, sound: true }, { contacts: 'cues.hits' }]) {
    const piece = validate({ ...external.piece, sound() {} });
    assert.throws(() => planStrip(piece, strip), /^Error: seeds: state-fail fails to build at state\(\): state boom$/, JSON.stringify(strip));
  }
});

test('contact sheet: a seeds run builds the piece once for a --frames, --contacts or --shots strip and its page', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-build-once-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'build-once.cjs');
  fs.writeFileSync(file, "module.exports = { name: 'build-once', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
    + " build: [['count', (s) => { process.stderr.write('BUILT\\n'); s.cues = { shots: [{ name: 'a', start: 0, end: 10 }, { name: 'b', start: 10, end: 20 }], hits: [{ frame: 5 }] }; }]],"
    + ' draw(g) { g.fillRect(0, 0, 100, 50); } };\n');
  for (const args of [['--frames', '3'], ['--contacts', 'cues.hits'], ['--shots']]) {
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), file, ...args], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr.split('BUILT').length - 1, 1, args.join(' '));
  }
});

test('contact sheet: shotList refuses a shot list that names two shots alike, by index and name', () => {
  const base = validate(EXAMPLES.readout);
  const p = { ...base, build: [...base.build, ['twice', (s) => { s.cues = { ...s.cues, shots: s.cues.shots.map((x) => ({ ...x, name: 'read' })) }; }]] };
  const message = `seeds: state.cues.shots entry [1] is a second shot named read in readout; give each shot its own name, as shots() does\n${USAGE}`;
  assert.throws(() => shotList(p), { message });
  for (const strip of [{ shots: true }, { frames: 3 }, { frames: 3, sound: true }]) assert.throws(() => planStrip(p, strip), { message }, JSON.stringify(strip));
});

test('contact sheet: a page that tags its own shots refuses a shot list that names two shots alike with planStrip\'s message, and fails every cell with it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-twice-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'twice.cjs');
  fs.writeFileSync(file, "module.exports = { name: 'twice', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
    + " build: [['cues', (s) => { s.cues = { shots: [{ name: 'a', start: 0, end: 10 }, { name: 'a', start: 10, end: 20 }] }; }]],"
    + ' draw(g) { g.fillRect(0, 0, 100, 50); } };\n');
  const external = loadExternal(file), p = validate(external.piece);
  const message = `seeds: state.cues.shots entry [1] is a second shot named a in twice; give each shot its own name, as shots() does\n${USAGE}`;
  assert.throws(() => planStrip(p, { frames: 3 }), { message });
  const { window } = runStrip({ frames: 3 }, {}, 'twice', [], 0, external, null, null, null, null, null, planStrip(p, { frames: 3 }, true));
  assert.ok(window.__sheet, 'the page finishes its sheet');
  const sheet = JSON.parse(JSON.stringify(window.__sheet));
  assert.throws(() => refuseSheet(sheet), { message }, 'the tool refuses with planStrip\'s message');
  assert.doesNotThrow(() => refuseSheet({ ...sheet, refusal: undefined }), 'a sheet the page did not refuse passes');
  assert.deepEqual(sheet.cells.map((c) => [c.frame, c.error === message.split('\n')[0], 'shot' in c]), [[0, true, false], [10, true, false], [19, true, false]]);
});

test('contact sheet: seeds main hands a --json strip to the page to tag, refuses the sheet the page refused, and a plain run captures nothing', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-twice-main-'));
  const argv = process.argv, error = console.error, log = console.log;
  t.after(() => {
    process.argv = argv; console.error = error; console.log = log;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'twice.cjs');
  fs.writeFileSync(file, "module.exports = { name: 'twice', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
    + " build: [['cues', (s) => { s.cues = { shots: [{ name: 'a', start: 0, end: 10 }, { name: 'a', start: 10, end: 20 }] }; }]],"
    + ' draw(g) { g.fillRect(0, 0, 100, 50); } };\n');
  const refusal = 'seeds: state.cues.shots entry [1] is a second shot named a in twice; give each shot its own name, as shots() does';
  // A stand-in capture: Edge would draw the page and read back a sheet the page refused.
  const captured = [];
  const capture = async (html, stem, options) => {
    captured.push(options);
    return { shots: [], cells: options.cells, failures: 3, sheet: { cells: [], refusal } };
  };
  console.error = console.log = () => {};
  const once = path.join(dir, 'once.cjs');
  fs.writeFileSync(once, fs.readFileSync(file, 'utf8').replace("name: 'twice'", "name: 'once'").replace("name: 'a', start: 10", "name: 'b', start: 10"));
  const run = (piece, ...flags) => {
    process.argv = [process.execPath, 'contact-sheet.js', piece, '--frames', '3', ...flags];
    return main(capture).then(() => null, (e) => e.message);
  };
  assert.equal(await run(file, '--json'), `${refusal}\n${USAGE}`, 'the page tags the shots, and main refuses with its refusal');
  assert.deepEqual(captured.map((o) => [o.cells, o.images]), [[3, false]], 'the page was drawn: Node left the shots to it');
  assert.equal(await run(file), `${refusal}\n${USAGE}`, 'a plain run builds in Node and refuses there');
  assert.equal(await run(once), null, 'a plain run writes the page');
  assert.equal(captured.length, 1, 'a plain run captures nothing');
});

test('contact sheet: a refused --png strip leaves no earlier image under its name', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-refused-png-'));
  const argv = process.argv, error = console.error, log = console.log;
  t.after(() => {
    process.argv = argv; console.error = error; console.log = log;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const twice = path.join(dir, 'twice.cjs'), still = path.join(dir, 'still.cjs');
  fs.writeFileSync(twice, "module.exports = { name: 'twice', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },"
    + " build: [['cues', (s) => { s.cues = { shots: [{ name: 'a', start: 0, end: 10 }, { name: 'a', start: 10, end: 20 }] }; }]],"
    + ' draw(g) { g.fillRect(0, 0, 100, 50); } };\n');
  // No time: a --frames strip of it is refused in Node, before any page is drawn.
  fs.writeFileSync(still, "module.exports = { name: 'still', size: { w: 100, h: 50 }, seed: 1, draw(g) { g.fillRect(0, 0, 100, 50); } };\n");
  const earlier = ['twice-frames.png', 'twice-frames-1-of-2.png', 'twice-frames-2-of-2.png', 'still-frames.png'];
  const other = 'twice-frames-seed3.png';
  for (const name of [...earlier, other]) fs.writeFileSync(path.join(dir, name), 'earlier run');
  // A stand-in capture: Edge would draw the page and read back a sheet the page refused.
  const capture = async (html, stem, options) => ({ shots: [], cells: options.cells, failures: 3, sheet: { cells: [], refusal: 'seeds: refused' } });
  console.error = console.log = () => {};
  const run = (piece, ...flags) => {
    process.argv = [process.execPath, 'contact-sheet.js', piece, '--frames', '3', ...flags];
    return main(capture).then(() => null, (e) => e.message);
  };
  assert.equal(await run(twice, '--json'), `seeds: refused\n${USAGE}`, 'the page refuses the strip');
  assert.ok(fs.existsSync(path.join(dir, earlier[0])), 'a run that asks for no images keeps the earlier ones');
  assert.equal(await run(twice, '--png'), `seeds: refused\n${USAGE}`, 'the page refuses the strip');
  assert.match(await run(still, '--png'), /^seeds: still is a still; a time strip needs a timeline/, 'Node refuses a time strip of a still');
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.png')), [other], 'only another sheet\'s image stays');
});

test('contact sheet: a refused --png sheet of several pieces leaves no earlier section under its name', async (t) => {
  // Examples write to out/; every view gives the sheet a name no other run uses. Every file in that folder
  // whose name starts with the stem's basename is backed up first and put back after, whatever its name.
  const views = ['--values', '--grey', '--colour-vision', '--gamut', PRINT_FILE];
  const stem = sheetStem(['drift', 'specimen'], [], null, null, null, null, { values: true, grey: true, colourVision: true, gamut: true });
  const earlier = ['', '-drift', '-drift-1-of-2', '-specimen', '-gone'].map((name) => `${stem}${name}.png`);
  const folder = path.dirname(stem), prefix = path.basename(stem);
  const present = () => (fs.existsSync(folder) ? fs.readdirSync(folder) : []).filter((name) => name.startsWith(prefix)).map((name) => path.join(folder, name));
  const kept = present().map((file) => [file, fs.readFileSync(file)]);
  const argv = process.argv, error = console.error, log = console.log;
  t.after(() => {
    process.argv = argv; console.error = error; console.log = log;
    for (const file of present()) fs.rmSync(file, { force: true });
    for (const [file, bytes] of kept) fs.writeFileSync(file, bytes);
  });
  fs.mkdirSync(path.dirname(stem), { recursive: true });
  for (const file of earlier) fs.writeFileSync(file, 'earlier run');
  console.error = console.log = () => {};
  // No piece named: a sheet of every example, one section each, which the stand-in capture says the page refused.
  process.argv = [process.execPath, 'contact-sheet.js', '--png', ...views];
  const capture = async (html, at, options) => ({ shots: [], cells: options.cells, failures: 0, sheet: { cells: [], refusal: 'seeds: refused' } });
  const refusal = await main(capture).then(() => null, (e) => e.message);
  assert.equal(refusal, `seeds: refused\n${USAGE}`, 'the page refuses the sheet');
  assert.deepEqual(earlier.filter((file) => fs.existsSync(file)), [], 'no earlier section or sheet image stays');
});

test('contact sheet: a strip measures no change, hold or light across a cut, on --at and --shots strips alike', () => {
  // Each canvas, numbered by its first read, gets a bright disc 0.2 of the cell's width further right.
  const disc = (place) => {
    const order = new Map();
    return (w, h, canvas) => {
      const d = new Uint8ClampedArray(w * h * 4);
      if (w * h === 1) return d;
      if (!order.has(canvas)) order.set(canvas, order.size);
      const cx = place(order.get(canvas)) * w, cy = h / 2, r = 0.06 * w;
      for (let i = 0; i < w * h; i++) {
        const v = Math.hypot(i % w - cx, Math.floor(i / w) - cy) < r ? 230 : 10;
        d.fill(v, 4 * i, 4 * i + 3);
        d[4 * i + 3] = 255;
      }
      return d;
    };
  };
  const at = JSON.parse(JSON.stringify(runStrip({ at: [5.5, 5.9, 6, 6.5] }, {}, 'readout', [], 3, null, null, null, null, disc((k) => 0.1 + 0.2 * k)).window.__sheet.cells));
  assert.deepEqual(at.map((c) => [c.frame, c.shot]), [[132, 'read'], [141, 'read'], [144, 'rest'], [156, 'rest']]);
  assert.deepEqual([at[2].change, at[2].hold, at[2].light.move, at[2].light.step], [null, null, null, null], 'the cell that opens a shot');
  for (const i of [1, 3]) assert.equal(typeof at[i].change, 'number', `cell ${i} change`);
  assert.equal(typeof at[3].light.move, 'number', 'cell 3 light move');
  const shots = JSON.parse(JSON.stringify(runStrip({ shots: true }, {}, 'readout', [], 3, null, null, null, null, disc((k) => (k < 3 ? 0.2 : 0.8))).window.__sheet.cells));
  assert.deepEqual([shots[3].mark, shots[3].change, shots[3].hold], ['first', null, null], 'a --shots cell marked first');
  assert.equal(typeof shots[4].change, 'number', 'cell 4 change');
});

test('contact sheet: a strip flags a cell unscaled on its own line when its draw resets the cell\'s scale, but not a device-pixel copy or a cell at scale 1', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-reset-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const load = (name, draw) => {
    const file = path.join(dir, name + '.cjs');
    fs.writeFileSync(file, `module.exports = { name: '${name}', size: { w: 1920, h: 1080 }, seed: 1, time: { duration: 2, hz: 12 }, draw(g) { ${draw} } };\n`);
    return loadExternal(file);
  };
  const ground = "g.fillStyle = '#888'; g.fillRect(0, 0, 1920, 1080);";
  // A left-to-right ramp on every read, so each cell has one detail above the floor and none dips.
  const paint = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) d.fill(Math.round(255 * (i % w) / w), 4 * i, 4 * i + 3), d[4 * i + 3] = 255;
    return d;
  };
  const strip = (name, draw, options = { frames: 3 }) => {
    const { window, elements } = runStrip(options, {}, name, [], 0, load(name, draw), null, null, null, paint);
    return { sheet: JSON.parse(JSON.stringify(window.__sheet)), elements };
  };
  const reset = ground + " g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#222'; g.fillRect(1200, 600, 200, 200);";
  const { sheet, elements } = strip('reset-film', reset);
  assert.deepEqual(sheet.flags.empty, []);
  assert.deepEqual(sheet.flags.unscaled.map((u) => [u.cell, u.marks]), [[0, 1], [1, 1], [2, 1]]);
  assert.deepEqual(sheet.cells.map((cell) => cell.unscaled), [1, 1, 1]);
  const flag = elements.filter((el) => el.tag === 'figcaption')[0].children.find((child) => child.className === 'flag');
  assert.match(flag.textContent, /^unscaled: 1 mark painted at 1 pixel per design unit after setTransform, resetTransform, reset\(\) or a restore\(\) past the draw's own saves dropped the cell's scale of 0\.3333/);
  assert.match(elements.find((el) => el.className === 'note flag').textContent, / 3 cells painted marks unscaled\.$/);
  const kept = strip('kept-film', ground + " g.fillStyle = '#222'; g.fillRect(1200, 600, 200, 200);").sheet;
  const copy = strip('copy-film', ground + ' g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage({ width: 1, height: 1 }, 0, 0); g.restore(); g.fillRect(1200, 600, 200, 200);').sheet;
  for (const [what, s] of [['kept-film', kept], ['copy-film', copy]]) {
    assert.deepEqual([s.flags.empty, s.flags.unscaled], [[], []], what);
    assert.deepEqual(s.cells.map((cell) => cell.unscaled), [0, 0, 0], what);
  }
  const flat = strip('reset-film', reset, { frames: 3, scale: 1 }).sheet;
  assert.deepEqual([flat.flags.empty, flat.flags.unscaled], [[], []], 'a cell drawn at scale 1 is drawn as the film is');
});

test('contact sheet: a strip page draws its flags into window.__sheet and onto the sheet', () => {
  const html = page(['readout'], 3, 1, [], null, null, { frames: 3 });
  assert.match(html, new RegExp('var RULES = ' + JSON.stringify(STRIP_RULES).replace(/[.{}]/g, '\$&') + ';'));
  assert.match(html, /flags = stripFlags\(results, lumas, RULES, p\.size\.w, STRIP\.twoValues\);/);
  assert.match(html, /flags: flags, failures:/);
  assert.match(html, /nearly empty: detail under/);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
  const fixture = loadExternal(path.join(__dirname, 'fixtures', 'empty-film.cjs'));
  const p = validate(fixture.piece);
  assert.equal(solve(p, p.seed).stages.error, null, 'the calibration fixture builds');
  assert.deepEqual(planStrip(p, { frames: 11 }).cells.map((cell) => +cell.seconds.toFixed(2)),
    [0, 2, 4, 6, 8, 10, 11.92, 13.92, 15.92, 17.92, 19.92], 'its --frames 11 strip shows its blank at 4 s, its hatching at 8 s and its hold from 11.92 s');
});

// `seconds` of samples at 48 kHz, two channels, sample i of each `wave(i / 48000)`.
const buffer48k = (seconds, wave) => {
  const ch = Float32Array.from({ length: Math.round(seconds * 48000) }, (_, i) => wave(i / 48000));
  return [ch, ch.slice()];
};

test('contact sheet: a soundtrack picture puts a tone in the log-frequency row holding it, at its level', () => {
  // 1500 Hz is bin 128 of the 4096-point transform at 48 kHz, so its level is exact.
  const pic = soundPicture(buffer48k(1, (t) => 0.5 * Math.sin(2 * Math.PI * 1500 * t)), 48000, 50, 96);
  assert.deepEqual([pic.from, pic.to, pic.seconds], [40, 16000, 1]);
  const row = Math.floor((96 * Math.log(1500 / 40)) / Math.log(16000 / 40));
  // Columns whose transform lies inside the buffer; at its ends the window is padded with silence.
  for (const c of [12, 25, 37]) {
    const column = Array.from(pic.spectrum.subarray(c * 96, (c + 1) * 96));
    assert.equal(column.indexOf(Math.max(...column)), row, `column ${c}: the loudest row holds 1500 Hz`);
    assert.ok(Math.abs(column[row] + 6.02) < 0.05, `column ${c}: a sine of amplitude 0.5 reads -6 dB, not ${column[row]}`);
    assert.ok(column[row - 8] < -60 && column[row + 8] < -60, `column ${c}: a third of an octave away the tone is gone`);
  }
  assert.ok(Math.abs(pic.rms[25] + 9.03) < 0.05, 'its RMS is -9 dBFS');
  assert.ok(Math.abs(pic.high[25] - 0.5) < 0.01 && Math.abs(pic.low[25] + 0.5) < 0.01, 'the waveform spans the sine');
  // The same tone in one channel only, and in antiphase: levels are the channels' mean power.
  const [left] = buffer48k(1, (t) => 0.5 * Math.sin(2 * Math.PI * 1500 * t));
  const one = soundPicture([left, new Float32Array(left.length)], 48000, 50, 96), anti = soundPicture([left, left.map((v) => -v)], 48000, 50, 96);
  assert.ok(Math.abs(one.rms[25] + 12.04) < 0.05 && Math.abs(one.spectrum[25 * 96 + row] + 9.03) < 0.05, 'one channel of two is half the power, -3 dB, not -6');
  assert.ok(Math.abs(anti.rms[25] + 9.03) < 0.05 && Math.abs(anti.spectrum[25 * 96 + row] + 6.02) < 0.05 && anti.high[25] > 0.49, 'antiphase does not cancel');
});

test('contact sheet: a soundtrack picture refuses a track with no samples, and its summary is its peak and envelope range', () => {
  for (const channels of [[], [new Float32Array(0), new Float32Array(0)]]) {
    assert.throws(() => soundPicture(channels, 48000, 50, 16), { message: 'the soundtrack holds no samples, so there is nothing to draw' });
  }
  const pic = soundPicture(buffer48k(2, (t) => (t < 1.25 ? 0.1 : 0.8) * Math.sin(2 * Math.PI * 220 * t)), 48000, 200, 16);
  const { peakDb, rmsDb } = soundSummary(pic);
  assert.ok(Math.abs(peakDb - 20 * Math.log10(0.8)) < 0.01, `the peak reads the louder part, ${peakDb}`);
  assert.deepEqual(rmsDb, { min: Math.min(...pic.rms), max: Math.max(...pic.rms) });
  assert.deepEqual(soundSummary({ columns: 1, low: [0], high: [0], rms: [-120] }), { peakDb: -240, rmsDb: { min: -120, max: -120 } }, 'silence');
});

test('contact sheet: shotList reads state.cues.shots, null when a piece keeps none', () => {
  const p = validate(EXAMPLES.readout);
  assert.deepEqual(shotList(p), solve(p, p.seed).state.cues.shots);
  assert.equal(shotList(validate(EXAMPLES.cascade)), null);
});

test('contact sheet: a shot list holding a null entry or an unnamed shot is invalid, so --sound draws no cuts and --shots refuses it by name', () => {
  // shots() in core/time.js refuses an empty name too.
  const holes = { null: (l) => [...l, null], undefined: (l) => [...l, undefined], "''": (l) => [{ ...l[0], name: '' }, ...l.slice(1)] };
  for (const [hole, edit] of Object.entries(holes)) {
    const p = validate({ ...EXAMPLES.readout, build: [...EXAMPLES.readout.build, ['leave a hole', (s) => { s.cues = { shots: edit(s.cues.shots) }; }]] });
    assert.equal(shotList(p), null, String(hole));
    assert.deepEqual(planStrip(p, { frames: 3, sound: true }).sound.cuts, [], String(hole));
    assert.throws(() => planStrip(p, { shots: true }), /--shots reads readout's shot list from state\.cues\.shots, the list shots\(\) returns, and readout keeps none there/, String(hole));
  }
});

test('contact sheet: a soundtrack picture shows a gain step in its envelope at the time it happens', () => {
  // Amplitude 0.1 until 1.25 s, then 0.8: -23 dBFS RMS, then -4.9.
  const pic = soundPicture(buffer48k(2, (t) => (t < 1.25 ? 0.1 : 0.8) * Math.sin(2 * Math.PI * 220 * t)), 48000, 200, 64);
  assert.ok(Math.abs(pic.rms[50] + 23.01) < 0.1 && Math.abs(pic.rms[180] + 4.94) < 0.1, `${pic.rms[50]} and ${pic.rms[180]}`);
  const rise = pic.rms.findIndex((db) => db > -14);
  // Column c's middle is (c + 0.5) * 10 ms; the 50 ms envelope reaches the step 25 ms early.
  assert.ok(Math.abs((rise + 0.5) * 0.01 - 1.25) <= 0.03, `the envelope rises at column ${rise}`);
  assert.ok(pic.high[124] < 0.11 && pic.high[125] > 0.7, 'the waveform steps in the column holding 1.25 s');
});

test('contact sheet: --sound lays the soundtrack under a strip on one time axis, with the frames shown and the shot cuts', () => {
  const args = parseArgs(['readout', '--frames', '9', '--sound', '--png']);
  assert.equal(args.strip.sound, true);
  assert.equal(sheetStem(['readout'], [], null, null, args.strip), path.join(__dirname, '..', 'out', 'readout-frames-sound'));
  const p = validate(EXAMPLES.readout), strip = planStrip(p, args.strip);
  const across = 3 * 642 + 2 * 14;
  assert.equal(sheetWidth(9, [], strip), 48 + across, 'the soundtrack is as wide as a row of cells');
  assert.deepEqual(strip.sound.marks, strip.cells.map((cell) => ({ frame: cell.frame, x: Math.min(across - 1, Math.round((cell.frame / 168) * across)) })));
  const film = solve(p, p.seed).state.cues.shots;
  assert.deepEqual(strip.sound.cuts, film.slice(1).map((s) => ({ shot: s.name, frame: s.start, x: Math.round((s.start / 168) * across) })));
  assert.equal(planStrip(p, { frames: 9 }).sound, undefined, 'a strip without --sound has no soundtrack');
  assert.deepEqual(planStrip(validate(EXAMPLES.cascade), { frames: 3, sound: true }).sound.cuts, [], 'a piece with no shot list has no cuts');
  assert.throws(() => planStrip(validate(EXAMPLES.drift), { frames: 3, sound: true }), /--sound draws drift's soundtrack, and drift declares no sound/);
  assert.throws(() => parseArgs(['readout', '--sound']), /--sound belong to a time strip/);
  assert.doesNotMatch(page(['readout'], 3, 1, [], null, null, { frames: 3 }), /soundPicture/, 'the plain strip page is unchanged');
  assert.match(page(['readout'], 3, 1, [], null, null, { frames: 3, sound: true }), /function soundProfile\(/, 'the --sound page measures its events');
});

test('contact sheet: a --sound strip page draws the rendered soundtrack before it offers window.__sheet', async () => {
  const { Context } = fakeAudio();
  const { window, cells } = runStrip({ frames: 3, sound: true }, { OfflineAudioContext: Context, Promise, Float32Array, Float64Array, Math });
  assert.equal(window.__sheet, undefined, 'the sheet waits for its soundtrack');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.__sheet.cells.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(window.__sheet.sound)), { error: null, level: { measured: { lufs: null, dbtp: null }, gain: 0, lufs: null, dbtp: null }, seconds: 7, peakDb: -240, rmsDb: { min: -120, max: -120 },
    silences: [{ from: 0, to: 7 }], profile: { events: [], median: { attackMs: null, decayMs: null, centroidHz: null, octaves: null } } },
    'a silent render is levelled as the export levels it, and reads as silence with no sound events');
  assert.ok(cells.some((c) => c.width === 3 * 642 + 2 * 14 && c.height === 16 + 128 + 6 + 192 + 18), 'the soundtrack canvas');
});

test('contact sheet: beatSummary gives each beat its span, peak, change and, with sound, its events and 50 ms RMS level', () => {
  // Beat 2 shares beat 3's frame, so its span is empty; the peak is the first beat at intensity 1.
  const beats = [{ frame: 0, intensity: 0.2 }, { frame: 10, intensity: 1 }, { frame: 20, intensity: 1 }, { frame: 20, intensity: 0.3 }];
  const cells = [{ frame: 0, change: null, error: null }, { frame: 4, change: 1, error: null }, { frame: 8, change: 3, error: null },
    { frame: 12, change: 9, error: null }, { frame: 16, change: 5, error: 'x' }, { frame: 24, change: null, error: null }, { frame: 28, change: 4, error: null }];
  // The cell at 24 follows a failed cell, so it counts nothing.
  // 30 columns of 0.1 s: -40 dB in beat 0, -10 in beat 1, -30 in beat 3 with one column at -20.
  const rms = Float32Array.from({ length: 30 }, (_, c) => (c < 10 ? -40 : c < 20 ? -10 : c === 25 ? -20 : -30));
  const sound = { seconds: 3, rms, events: [{ seconds: 0.5, peakDb: -30 }, { seconds: 1.2, peakDb: -6 }, { seconds: 1.5, peakDb: -8 }] };
  const span = (frame, end, intensity, peak) => ({ frame, end, seconds: frame / 10, endSeconds: end / 10, intensity, peak });
  const lumas = cells.map(() => true);
  assert.deepEqual(beatSummary(beats, 30, 10, cells, lumas, sound), [
    { ...span(0, 10, 0.2, false), cells: 2, change: { max: 3, median: 2 }, events: 1, loudestDb: -30, rmsDb: { max: -40, median: -40 } },
    { ...span(10, 20, 1, true), cells: 1, change: { max: 9, median: 9 }, events: 2, loudestDb: -6, rmsDb: { max: -10, median: -10 } },
    { ...span(20, 20, 1, false), cells: 0, change: { max: null, median: null }, events: 0, loudestDb: null, rmsDb: { max: null, median: null } },
    { ...span(20, 30, 0.3, false), cells: 1, change: { max: 4, median: 4 }, events: 0, loudestDb: null, rmsDb: { max: -20, median: -30 } },
  ]);
  const silent = beatSummary(beats, 30, 10, cells, lumas, null);
  assert.ok(silent.every((b) => !('events' in b) && !('loudestDb' in b) && !('rmsDb' in b)), 'without sound a beat has no sound fields');
  for (const bad of [null, {}, [], [{ frame: 10, intensity: 1 }, { frame: 5, intensity: 1 }], [{ frame: 1.5, intensity: 1 }], [{ frame: 31, intensity: 1 }], [{ frame: 0 }]]) {
    assert.equal(beatSummary(bad, 30, 10, cells, lumas, sound), null, JSON.stringify(bad));
  }
  const serialized = new Function(trustedCell.toString() + '\nreturn (' + beatSummary.toString() + ')')();
  assert.equal(JSON.stringify(serialized(beats, 30, 10, cells, lumas, sound)), JSON.stringify(beatSummary(beats, 30, 10, cells, lumas, sound)), 'it runs serialized, as the strip page runs it');
  // The parameters stay positional: a swapped call is not refused by name, it throws a TypeError.
  assert.throws(() => beatSummary(beats, 30, 10, cells, sound, lumas), TypeError, 'sound before lumas');
  assert.throws(() => beatSummary(beats, 30, 10, cells, null, lumas), TypeError, 'no sound, lumas in its slot');
});

test('contact sheet: beatSummary counts a change across a beat edge in the more intense beat, so a peak keeps its onset and its drop', () => {
  // The peak spans frames 10 to 20. The cell at 12 measures its onset from frame 6 and the cell
  // at 24 its drop from frame 18; the middles of both pairs (9 and 21) lie outside the peak.
  const beats = [{ frame: 0, intensity: 0.2 }, { frame: 10, intensity: 1 }, { frame: 20, intensity: 0.2 }];
  const cells = [0, 6, 12, 18, 24, 30].map((frame, k) => ({ frame, change: [null, 1, 9, 3, 8, 2][k], error: null }));
  const lumas = cells.map(() => true);
  assert.deepEqual(beatSummary(beats, 36, 10, cells, lumas, null).map((b) => [b.cells, b.change]),
    [[1, { max: 1, median: 1 }], [3, { max: 9, median: 8 }], [1, { max: 2, median: 2 }]]);
  // Between equal beats the change counts in the later one, the beat holding the cell.
  beats[1].intensity = 0.2;
  assert.deepEqual(beatSummary(beats, 36, 10, cells, lumas, null).map((b) => b.cells), [1, 2, 2]);
});

test('contact sheet: beatSummary ignores the change of a raw cell that follows a failed cell', () => {
  // The cell at 12 follows the failed cell at 8 and carries a change of 50; it counts nothing, as stripFlags treats it for holds.
  const beats = [{ frame: 0, intensity: 0.2 }, { frame: 10, intensity: 1 }];
  const cells = [{ frame: 0, change: null, error: null }, { frame: 8, change: 2, error: 'x' }, { frame: 12, change: 50, error: null }, { frame: 16, change: 3, error: null }];
  assert.deepEqual(beatSummary(beats, 20, 10, cells, cells.map(() => true), null).map((b) => [b.cells, b.change.max]), [[0, null], [1, 3]]);
});

test('contact sheet: beatSummary and stripFlags trust the same cells, so a cell with no luma counts no change and breaks a hold', () => {
  // Eight still frames, one a second; the cell at 3 has no luma, as a cell the page never measured.
  const cells = Array.from({ length: 8 }, (_, i) => ({ frame: i, seconds: i, t: i, detail: 5, error: null }));
  const lumas = cells.map(() => frameDetail(greyImage(160, 80, () => 50)).luma);
  lumas[3] = null;
  cells.forEach((c, i) => { c.change = i ? i : null; });
  // Beat 0 keeps the changes at 1 and 2; beat 1 those at 5, 6 and 7, not the cell at 4 after the untrusted one.
  // Asserted before stripFlags runs, which reads the luma of every cell it trusts.
  const beats = [{ frame: 0, intensity: 0.2 }, { frame: 4, intensity: 1 }];
  assert.deepEqual(beatSummary(beats, 8, 1, cells, lumas, null).map((b) => [b.cells, b.change.max]), [[2, 2], [3, 7]]);
  stripFlags(cells, lumas, STRIP_RULES);
  assert.deepEqual([cells[3].hold, cells[4].hold], [null, null], 'the cell with no luma and the cell after it are not judged');
});

test('contact sheet: beatSummary gives a beat that holds no shown cell no change, even a peak between two cells', () => {
  // The peak spans frames 10 to 14, inside the gap between the cells at 0 and 20,
  // so the change at 20 is measured between two quiet frames and counts in beat 14.
  const beats = [{ frame: 0, intensity: 0.2 }, { frame: 10, intensity: 1 }, { frame: 14, intensity: 0.2 }];
  const cells = [0, 20, 30].map((frame, k) => ({ frame, change: [null, 7, 1][k], error: null }));
  assert.deepEqual(beatSummary(beats, 40, 10, cells, cells.map(() => true), null).map((b) => [b.frame, b.end, b.cells, b.change.max]),
    [[0, 10, 0, null], [10, 14, 0, null], [14, 40, 2, 7]]);
});

test('contact sheet: beatSummary cuts each RMS column at its beat, so a quiet beat never reads its neighbour\'s hit', () => {
  // 3 s at 1000 Hz: -60 dB for the first second, then a full-scale hit; 40 ms columns,
  // so the last column of beat 0 (middle 0.98 s) has a 50 ms window reaching 5 ms into the hit.
  const rate = 1000, samples = Float32Array.from({ length: 3 * rate }, (_, i) => (i < rate ? 0.001 : 1) * (i % 2 ? 1 : -1));
  const squares = new Float64Array(samples.length + 1);
  samples.forEach((s, i) => { squares[i + 1] = squares[i] + s * s; });
  const pic = soundPicture([samples], rate, 75, 4, squares);
  const sound = { seconds: pic.seconds, rms: pic.rms, events: [], squares };
  const [quiet, loud] = beatSummary([{ frame: 0, intensity: 0.2 }, { frame: 10, intensity: 1 }], 30, 10, [], [], sound);
  assert.deepEqual(quiet.rmsDb, { max: -60, median: -60 });
  assert.deepEqual(loud.rmsDb, { max: 0, median: 0 });
});

test('contact sheet: a strip of a film that keeps cues.beats adds window.__sheet.beats, with its sound fields under --sound', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-beats-'));
  const file = path.join(dir, 'beats-film.cjs');
  fs.writeFileSync(file, "module.exports = { name: 'beats-film', size: { w: 64, h: 36 }, seed: 1, time: { duration: 2, hz: 12 },"
    + " build: [['plan', (s) => { s.cues = { beats: [{ frame: 0, intensity: 0.2 }, { frame: 8, intensity: 1 }, { frame: 16, intensity: 0.3 }] }; }]],"
    + " draw(g) { g.fillStyle = '#888'; g.fillRect(0, 0, 64, 36); }, sound() {} };\n");
  const external = loadExternal(file);
  // Frames 0, 5, 9, 14, 18 and 23; the first cell has no change, and the
  // cells at 9 and 18, whose changes cross into or out of the peak, count in it.
  const { window } = runStrip({ frames: 6 }, {}, 'beats-film', [], 0, external);
  // Copied out of the page's realm, so deepEqual compares plain values.
  const sheet = JSON.parse(JSON.stringify(window.__sheet));
  assert.deepEqual(sheet.beats.map((b) => [b.frame, b.end, b.peak, b.cells]), [[0, 8, false, 1], [8, 16, true, 3], [16, 24, false, 1]]);
  sheet.beats.forEach((b, i) => {
    const inside = [[1], [2, 3, 4], [5]][i].map((k) => sheet.cells[k].change);
    assert.equal(b.change.max, Math.max(...inside), `beat at frame ${b.frame}`);
  });
  const heard = runStrip({ frames: 6, sound: true }, { OfflineAudioContext: fakeAudio().Context, Promise, Float32Array, Float64Array, Math }, 'beats-film', [], 0, external);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(heard.window.__sheet.sound.error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(heard.window.__sheet.beats)).map((b) => [b.events, b.loudestDb, b.rmsDb]), Array(3).fill([0, null, { max: -120, median: -120 }]), 'a silent soundtrack');
  assert.ok(!('beats' in runStrip({ frames: 3 }).window.__sheet), 'a piece that keeps no beats gets no beats key');
});

test('contact sheet: on fixtures/peak-film.cjs a --sound strip gives each beat its level, with the peak 3 dB over the quiet beats and the bed heard without an event', async () => {
  const external = loadExternal(path.join(__dirname, 'fixtures', 'peak-film.cjs'));
  // runStrip's canvases read back transparent pixels, so every change here is
  // 0: the peak's change.max and its 2x margin are checked only by hand in Edge
  // (docs/knowledge/command-line-tools.md gives the command and the numbers).
  // The fixture plays one computed buffer straight into the destination, so
  // copying each started buffer into the output renders it as Web Audio does.
  const { Context, record } = fakeAudio();
  class Mixing extends Context {
    async startRendering() {
      const out = await super.startRendering();
      for (const n of record.nodes.filter((x) => x.kind === 'bufferSource' && x.at !== null)) {
        const at = Math.round(n.at * this.sampleRate);
        for (let c = 0; c < out.numberOfChannels; c++) out.getChannelData(c).set(n.buffer.getChannelData(c).subarray(0, out.length - at), at);
      }
      return out;
    }
  }
  const { window } = runStrip({ frames: 18, sound: true }, { OfflineAudioContext: Mixing, Promise, Float32Array, Float64Array, Math }, 'peak-film', [], 0, external);
  await new Promise((resolve) => setImmediate(resolve));
  const sheet = JSON.parse(JSON.stringify(window.__sheet));
  assert.equal(sheet.sound.error, null);
  assert.deepEqual(sheet.beats.map((b) => [b.frame, b.end, b.intensity, b.peak]), [[0, 18, 0.2, false], [18, 36, 0.5, false], [36, 54, 1, true], [54, 72, 0.3, false]]);
  const [bed, , peak, settle] = sheet.beats, loudest = Math.max(...sheet.sound.profile.events.map((e) => e.peakDb));
  assert.equal(peak.loudestDb, loudest, 'the peak beat holds the loudest event');
  for (const quiet of [bed, settle]) {
    assert.ok(peak.loudestDb >= (quiet.loudestDb ?? -60) + 3, `the peak's loudest event is 3 dB over the beat at frame ${quiet.frame}`);
    assert.ok(quiet.rmsDb.max <= peak.rmsDb.max - 3, `the beat at frame ${quiet.frame} sits 3 dB under the peak's level`);
  }
  assert.equal(settle.events, 0, 'the hum alone is no event');
  assert.ok(settle.rmsDb.median > -40, `but its level is heard: ${settle.rmsDb.median} dB`);
});

test('contact sheet: soundStems splits film-scaffold sound rows into events, bed voices and ambience', () => {
  // Row 1 is the film scaffold's caused, swept voice held 0.8 s; row 2 a hit held 3 s; row 3 the scaffold's bed.
  const rows = [{ at: 0, voice: { pitch: 220 } }, { at: 1, voice: { attack: 0.2, hold: 0.8 } }, { at: 2, voice: { attack: 0.005, hold: 3 } },
    { at: 0, voice: { attack: 1.5, hold: 1 } }, { at: 0, voice: { attack: 0.5 } },
    { at: 0, ambience: { length: 2 } }, { at: 0, role: 'music', voice: { attack: 1, hold: 3 } }, { at: 1, role: 'sting', voice: {} }];
  const at = (stems) => Object.fromEntries(Object.entries(stems).map(([k, v]) => [k, v.map((r) => rows.indexOf(r))]));
  assert.deepEqual(at(soundStems(rows)), { events: [0, 1, 2], bed: [3, 4], ambience: [5] }, 'a voice that swells in over 0.5 s or more is a bed, a held caused voice is not; music and stings are in no stem');
  for (const none of [[], null, [{ at: 1 }], 'rows', [rows[0], null]]) assert.equal(soundStems(none), null, JSON.stringify(none));
  const alone = new Function(`return (${soundStems.toString()});`)();
  assert.deepEqual(at(alone(rows)), at(soundStems(rows)), 'it runs serialized');
});

test('contact sheet: shotGaps gives each shot its loudest event, bed and ambience level and flags a gap short of the guide', () => {
  // The running sum of a constant-amplitude signal's power, `amp(i)` per sample.
  const squares = (n, amp) => { const s = new Float64Array(n + 1); for (let i = 0; i < n; i++) s[i + 1] = s[i] + amp(i) ** 2; return s; };
  const spans = [{ shot: 'a', start: 0, end: 10 }, { shot: 'b', start: 10, end: 20 }];
  const stems = { rate: 1000, events: squares(2000, (i) => (i < 1000 ? 1 : 0)), bed: squares(2000, () => 0.1), ambience: squares(2000, () => 0.3) };
  const [a, b] = shotGaps(spans, 10, stems);
  assert.deepEqual(a, { shot: 'a', start: 0, end: 10, eventsDb: 0, bedDb: -20, ambienceDb: -10.5, bedGapDb: 20, ambienceGapDb: 10.5, short: ['ambience'] });
  assert.deepEqual(b, { shot: 'b', start: 10, end: 20, eventsDb: null, bedDb: -20, ambienceDb: -10.5, bedGapDb: null, ambienceGapDb: null, short: [] });
  const loud = shotGaps(spans, 10, { ...stems, bed: squares(2000, () => 0.4), ambience: squares(2000, () => 0) })[0];
  assert.deepEqual([loud.bedGapDb, loud.ambienceDb, loud.ambienceGapDb, loud.short], [8, null, null, ['bed']], 'a bed 8 dB under is short; a silent ambience is none');
  // A span shorter than 50 ms is measured whole: 10 loud samples of 30.
  assert.equal(shotGaps([{ shot: 'c', start: 0, end: 3 }], 100, { ...stems, events: squares(2000, (i) => (i < 10 ? 1 : 0)) })[0].eventsDb, -4.8);
  const alone = new Function(`return (${shotGaps.toString()});`)();
  assert.equal(JSON.stringify(alone(spans, 10, stems)), JSON.stringify(shotGaps(spans, 10, stems)), 'it runs serialized');
});

test('contact sheet: silentSpans lists each stretch of 0.5 s or more under -60 dBFS, at the start, between sounds and at the end', () => {
  const squares = (n, amp) => { const s = new Float64Array(n + 1); for (let i = 0; i < n; i++) s[i + 1] = s[i] + amp(i) ** 2; return s; };
  // At 1000 Hz: silent to 1 s, a sound, a 0.3 s gap, a sound, a 0.6 s gap, a sound to 3 s.
  const gappy = squares(3000, (i) => (i < 1000 || (i >= 1500 && i < 1800) || (i >= 2200 && i < 2800) ? 0 : 0.5));
  assert.deepEqual(silentSpans(gappy, 1000), [{ from: 0, to: 1 }, { from: 2.2, to: 2.8 }], 'the 0.3 s gap is a rest, not listed');
  assert.deepEqual(silentSpans(squares(2000, () => 0), 1000), [{ from: 0, to: 2 }], 'a silent track is one stretch');
  assert.deepEqual(silentSpans(squares(2000, (i) => (i < 1300 ? 0.5 : 0)), 1000), [{ from: 1.3, to: 2 }], 'a stretch reaching the end ends with the track');
  assert.deepEqual(silentSpans(squares(1000, () => 0.0005), 1000), [{ from: 0, to: 1 }], 'about -66 dBFS is under the floor');
  assert.deepEqual(silentSpans(squares(1000, () => 0.002), 1000), [], 'about -54 dBFS is above it');
  assert.deepEqual(silentSpans(new Float64Array(1), 1000), [], 'no samples, no stretch');
  const alone = new Function(`return (${silentSpans.toString()});`)();
  assert.equal(JSON.stringify(alone(gappy, 1000)), JSON.stringify(silentSpans(gappy, 1000)), 'it runs serialized');
});

test('contact sheet: a --sound strip shades a plain piece\'s silent opening and the gap between its sounds and lists them in sound.silences', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-silence-'));
  const file = path.join(dir, 'silence-film.cjs');
  // One square wave over [1, 1.5), [1.8, 2.2) and [2.8, 3) s, and no cues.sounds.
  fs.writeFileSync(file, "module.exports = { name: 'silence-film', size: { w: 64, h: 36 }, seed: 1, time: { duration: 3, hz: 12 },"
    + " draw(g) { g.fillStyle = '#888'; g.fillRect(0, 0, 64, 36); },"
    + " sound(ctx) { const b = ctx.createBuffer(2, ctx.length, ctx.sampleRate);"
    + " for (const [from, to] of [[1, 1.5], [1.8, 2.2], [2.8, 3]]) for (let c = 0; c < 2; c++) { const d = b.getChannelData(c);"
    + " for (let i = Math.round(from * ctx.sampleRate); i < Math.round(to * ctx.sampleRate); i++) d[i] = i % 2 ? -0.5 : 0.5; }"
    + " const n = ctx.createBufferSource(); n.buffer = b; n.connect(ctx.destination); n.start(0); } };\n");
  const external = loadExternal(file);
  const { Context, record } = fakeAudio();
  class Mixing extends Context {
    constructor(...args) { super(...args); this.first = record.nodes.length; }
    async startRendering() {
      const out = await super.startRendering();
      for (const n of record.nodes.slice(this.first).filter((x) => x.kind === 'bufferSource' && x.at !== null)) {
        for (let c = 0; c < out.numberOfChannels; c++) { const o = out.getChannelData(c), d = n.buffer.getChannelData(c); for (let i = 0; i < o.length; i++) o[i] += d[i]; }
      }
      return out;
    }
  }
  const { window, elements, draws } = runStrip({ frames: 6, sound: true }, { OfflineAudioContext: Mixing, Promise, Float32Array, Float64Array, Math }, 'silence-film', [], 0, external);
  for (let i = 0; i < 50 && !window.__sheet; i++) await new Promise((resolve) => setImmediate(resolve));
  const sheet = JSON.parse(JSON.stringify(window.__sheet));
  assert.equal(sheet.sound.error, null);
  assert.deepEqual(sheet.sound.silences, [{ from: 0, to: 1 }, { from: 2.2, to: 2.8 }]);
  const lines = elements.filter((el) => el.tag === 'p' && /^silent /.test(el.textContent || ''));
  assert.deepEqual(lines.map((el) => el.className), ['note flag', 'note flag']);
  assert.match(lines[0].textContent, /^silent 0\.00 to 1\.00 s, from the first frame/);
  assert.match(lines[1].textContent, /^silent 2\.20 to 2\.80 s, between sounds/);
  const shaded = draws.filter((d) => d.fill === 'rgba(120,190,255,0.18)');
  const W = shaded.length && shaded[0].canvas.width;
  assert.deepEqual(shaded.map((d) => d.args), [[0, 16, Math.round(W / 3), 128], [Math.round((2.2 / 3) * W), 16, Math.round((2.8 / 3) * W) - Math.round((2.2 / 3) * W), 128]],
    'each stretch is shaded across the waveform panel');
});

test('contact sheet: a --sound strip of a piece that keeps film-scaffold sounds renders events, bed and ambience apart and reports each shot\'s gaps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-gaps-'));
  const file = path.join(dir, 'gaps-film.cjs');
  // Each row plays one constant-amplitude buffer from `from` to `to` seconds, as
  // the film scaffold's sound() plays exactly the rows in s.cues.sounds.
  fs.writeFileSync(file, "module.exports = { name: 'gaps-film', size: { w: 64, h: 36 }, seed: 1, time: { duration: 2, hz: 12 },"
    + " build: [['plan', (s) => { s.cues = { shots: [{ name: 'a', start: 0, end: 12 }, { name: 'b', start: 12, end: 24 }], sounds: ["
    + " { at: 0.25, voice: { pitch: 220 }, from: 0.25, to: 0.45, amp: 1 }, { at: 0, voice: { attack: 1, hold: 1 }, from: 0, to: 2, amp: 0.2 },"
    + " { at: 0, ambience: { length: 2 }, from: 0, to: 2, amp: 0.15 }, { at: 0, role: 'music', voice: { hold: 2 }, from: 0, to: 2, amp: 0.9 }] }; }]],"
    + " draw(g) { g.fillStyle = '#888'; g.fillRect(0, 0, 64, 36); },"
    + " sound(ctx, s) { for (const r of s.cues.sounds) { const b = ctx.createBuffer(2, ctx.length, ctx.sampleRate);"
    + " for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = Math.round(r.from * ctx.sampleRate); i < Math.round(r.to * ctx.sampleRate); i++) d[i] = i % 2 ? -r.amp : r.amp; }"
    + " const n = ctx.createBufferSource(); n.buffer = b; n.connect(ctx.destination); n.start(0); } } };\n");
  const external = loadExternal(file);
  const { Context, record } = fakeAudio();
  // Sums the buffer sources started on this context only: the page renders four in turn.
  class Mixing extends Context {
    constructor(...args) { super(...args); this.first = record.nodes.length; }
    async startRendering() {
      const out = await super.startRendering();
      for (const n of record.nodes.slice(this.first).filter((x) => x.kind === 'bufferSource' && x.at !== null)) {
        for (let c = 0; c < out.numberOfChannels; c++) { const o = out.getChannelData(c), d = n.buffer.getChannelData(c); for (let i = 0; i < o.length; i++) o[i] += d[i]; }
      }
      return out;
    }
  }
  const { window, elements } = runStrip({ frames: 6, sound: true }, { OfflineAudioContext: Mixing, Promise, Float32Array, Float64Array, Math }, 'gaps-film', [], 0, external);
  for (let i = 0; i < 50 && !window.__sheet; i++) await new Promise((resolve) => setImmediate(resolve));
  const sheet = JSON.parse(JSON.stringify(window.__sheet));
  assert.equal(sheet.sound.error, null);
  assert.equal(sheet.sound.gapsError, undefined);
  assert.equal(record.contexts.length, 4, 'the mix, then the events, the bed and the ambience');
  assert.deepEqual(sheet.sound.gaps, [
    { shot: 'a', start: 0, end: 12, eventsDb: 0, bedDb: -14, ambienceDb: -16.5, bedGapDb: 14, ambienceGapDb: 16.5, short: ['ambience'] },
    { shot: 'b', start: 12, end: 24, eventsDb: null, bedDb: -14, ambienceDb: -16.5, bedGapDb: null, ambienceGapDb: null, short: [] },
  ]);
  const lines = elements.filter((el) => el.tag === 'p' && /^shot /.test(el.textContent || ''));
  assert.deepEqual(lines.map((el) => el.className), ['note flag', 'note']);
  assert.match(lines[0].textContent, /^shot a: events 0\.0 dBFS; bed 14\.0 dB under \(guide 10 to 20\); ambience 16\.5 dB under \(guide 20 or more\); ambience short of the guide/);
  assert.match(lines[1].textContent, /^shot b: events no event voice;/);
  assert.ok(sheet.sound.peakDb > -240, 'the soundtrack above is still the whole mix');
});

// A tone burst of `hz` at amplitude `a` starting at `at` seconds: a linear 4 ms
// rise, then an amplitude decay of exp(-t / tau), tau 10 ms unless given, so
// its power falls 20 dB in tau * ln 10 = 23.03 ms.
const burst = (t, at, hz, a, tau = 0.010) => {
  const u = t - at;
  return u < 0 ? 0 : a * (u < 0.004 ? u / 0.004 : Math.exp(-(u - 0.004) / tau)) * Math.sin(2 * Math.PI * hz * u);
};
// 1 s at 48 kHz: a 1000 Hz burst at 0.2 s and a 4000 Hz one at 0.6 s.
const twoBursts = () => buffer48k(1, (t) => burst(t, 0.2, 1000, 0.8) + burst(t, 0.6, 4000, 0.4));

test('contact sheet: a sound profile gives each event its attack, decay to -20 dB, octave shares and centroid', () => {
  const { events, median } = soundProfile(twoBursts(), 48000);
  assert.equal(events.length, 2, JSON.stringify(events.map((e) => e.seconds)));
  // The envelope is the power over 5 ms around each millisecond, so the event
  // sits about where the 4 ms rise ends, and the 5 ms window adds up to 5 ms to
  // the attack. The decay runs from there, the rise's last dB about 3 ms before
  // the peak, to 20 dB under the peak, 23 ms after it.
  for (const [e, at, hz] of [[events[0], 0.204, 1000], [events[1], 0.604, 4000]]) {
    assert.ok(Math.abs(e.seconds - at) <= 0.006, `peak at ${e.seconds} s, not ${at}`);
    assert.ok(e.attackMs >= 4 && e.attackMs <= 9, `attack ${e.attackMs} ms`);
    assert.ok(Math.abs(e.decayMs - 26) <= 2, `decay to -20 dB ${e.decayMs} ms`);
    assert.ok(e.octaves[hz] > 0.9, `${hz} Hz holds ${e.octaves[hz]} of the power`);
    const sum = Object.values(e.octaves).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) <= 0.01, `shares sum to ${sum}`);
    assert.ok(Math.abs(e.centroidHz - hz) <= hz * 0.05, `centroid ${e.centroidHz} Hz`);
  }
  assert.deepEqual(Object.keys(events[0].octaves), ['31', '63', '125', '250', '500', '1000', '2000', '4000', '8000', '16000']);
  assert.ok(events[0].peakDb - events[1].peakDb > 5, 'the louder burst peaks higher');
  assert.ok(Math.abs(median.decayMs - 26) <= 2 && median.attackMs === +((events[0].attackMs + events[1].attackMs) / 2).toFixed(1), JSON.stringify(median));
  assert.ok(Math.abs(median.octaves['1000'] - 0.5) <= 0.05, 'a band\'s median share is over every event');
  // The span is not tapered at its start, so a bright onset keeps its share: a
  // 2 ms white-noise click, with about 94% of its power above the 2000 Hz
  // band's lower edge (1414 Hz), before a 200 Hz tail.
  let state = 1;
  const noise = Float32Array.from({ length: 96 }, () => { state = (state * 16807) % 2147483647; return state / 2147483647 * 2 - 1; });
  const [struck] = buffer48k(1, (t) => { const u = t - 0.2; return u < 0 ? 0 : 0.5 * Math.exp(-u / 0.03) * Math.sin(2 * Math.PI * 200 * u); });
  noise.forEach((v, i) => { struck[9600 + i] += 0.9 * v; });
  const clickShare = noise.reduce((s, v) => s + (0.9 * v) ** 2, 0) / struck.reduce((s, v) => s + v * v, 0);
  const [hit] = soundProfile([struck], 48000).events;
  const bright = ['2000', '4000', '8000', '16000'].reduce((s, key) => s + hit.octaves[key], 0);
  assert.ok(bright >= 0.85 * clickShare && bright <= clickShare, `bands from 2000 Hz hold ${bright}, the click ${clickShare.toFixed(3)} of the power`);
  // A sound that rises and then holds its level peaks where its rise ends, not
  // at whichever ripple of its sustain stands highest: a tone, a chord and white
  // noise, each a 4 ms rise at 0.3 s held to 0.7 s, give one event with the
  // same attack as a burst and a decay through the hold.
  const held = (t) => { const u = t - 0.3; return u < 0 || u > 0.4 ? 0 : Math.min(1, u / 0.004); };
  state = 1;
  for (const [name, wave] of [
    ['a held tone', (t) => 0.5 * Math.sin(2 * Math.PI * 1000 * t)],
    ['a held chord', (t) => 0.3 * [262, 330, 392].reduce((s, hz) => s + Math.sin(2 * Math.PI * hz * t), 0)],
    ['held noise', () => { state = (state * 16807) % 2147483647; return state / 2147483647 - 0.5; }],
  ]) {
    const found = soundProfile(buffer48k(1, (t) => held(t) * wave(t)), 48000).events;
    assert.equal(found.length, 1, `${name}: events at ${JSON.stringify(found.map((e) => e.seconds))}`);
    assert.ok(found[0].attackMs >= 4 && found[0].attackMs <= 9, `${name}: attack ${found[0].attackMs} ms`);
    assert.ok(Math.abs(found[0].decayMs - 400) <= 10, `${name}: decay ${found[0].decayMs} ms through the hold`);
  }
  // A sound that does not rise sharply is no event: tones faded in over 300 ms,
  // down to 15 Hz, whose ripple in the 5 ms envelope the 25 ms mean evens out, and silence.
  for (const hz of [15, 20, 27, 30, 60, 220]) {
    assert.deepEqual(soundProfile(buffer48k(2, (t) => Math.min(1, t / 0.3) * 0.5 * Math.sin(2 * Math.PI * hz * t)), 48000).events, [], `${hz} Hz tone`);
  }
  const none = { events: [], median: { attackMs: null, decayMs: null, centroidHz: null, octaves: null } };
  assert.deepEqual(soundProfile(buffer48k(1, () => 0), 48000), none, 'silence');
  assert.deepEqual(soundProfile([], 48000), none, 'no channels');
  // Levels are the channels' mean power, so antiphase does not cancel.
  const [left] = twoBursts();
  const anti = soundProfile([left, left.map((v) => -v)], 48000).events;
  assert.deepEqual(anti.map((e) => [e.seconds, e.decayMs]), events.map((e) => [e.seconds, e.decayMs]));
});

test('contact sheet: a sound profile measures the event itself over a bed, after an earlier tail and in a track that starts with sound', () => {
  const hit = (t, at, a = 0.8, hz = 4000, tau = 0.01) => burst(t, at, hz, a, tau);
  const alone = soundProfile(buffer48k(2.5, (t) => hit(t, 1.5) + hit(t, 2)), 48000).events;
  // A 200 Hz bed 14 dB under the hits, faded in over 1 s: each hit is measured
  // from where it rises out of the bed to where it falls back into it, not from
  // the bed's own -20 dB point a second earlier or over 170 ms of bed.
  const bed = soundProfile(buffer48k(2.5, (t) => Math.min(1, t) * 0.16 * Math.sin(2 * Math.PI * 200 * t) + hit(t, 1.5) + hit(t, 2)), 48000).events;
  assert.deepEqual(bed.map((e) => e.seconds), alone.map((e) => e.seconds), 'the bed adds no event and moves none');
  for (const e of bed) {
    assert.ok(e.attackMs <= 10, `attack ${e.attackMs} ms over the bed, ${alone[0].attackMs} alone`);
    assert.equal(e.decayMs, null, 'the bed holds the envelope within 20 dB of the peak');
    assert.ok(e.octaves['4000'] >= 0.85 && e.octaves['250'] <= 0.1, `over the bed 4000 Hz holds ${e.octaves['4000']}, 250 Hz ${e.octaves['250']}`);
    assert.ok(Math.abs(e.centroidHz - 4000) <= 500, `centroid ${e.centroidHz} Hz over the bed`);
  }
  // A bright hit over a loud low bed, the 4000 Hz hit at 0.8 over a steady 40 Hz
  // bed at 0.3, rises only about 9 dB in the whole signal but far more in its
  // first difference: it is an event where the same hit alone is, its attack
  // within 1 ms and most of its power at 4000 Hz.
  const [lone] = soundProfile(buffer48k(1, (t) => hit(t, 0.3)), 48000).events;
  // The hit alone is measured as before the first difference was looked at: its
  // peak 3 ms after the 4 ms rise, attack 5 ms, decay 26 ms, all its power at 4000 Hz.
  assert.ok(lone.seconds === 0.303 && Math.abs(lone.peakDb + 6.5) <= 0.1 && lone.attackMs === 5 && Math.abs(lone.decayMs - 26) <= 1
    && lone.octaves['4000'] >= 0.99 && Math.abs(lone.centroidHz - 4000) <= 10, `the hit alone: ${JSON.stringify(lone)}`);
  const loud = soundProfile(buffer48k(1, (t) => 0.3 * Math.sin(2 * Math.PI * 40 * t) + hit(t, 0.3)), 48000).events;
  assert.equal(loud.length, 1, `a bright hit over a loud low bed: events at ${JSON.stringify(loud.map((e) => e.seconds))}`);
  assert.ok(Math.abs(loud[0].seconds - lone.seconds) <= 0.002 && Math.abs(loud[0].attackMs - lone.attackMs) <= 1 && loud[0].octaves['4000'] >= 0.6,
    `a bright hit over a loud low bed: ${JSON.stringify(loud[0])}, alone ${JSON.stringify(lone)}`);
  // The same at 0.8, 0.3, 0.2 and 0.1, whose whole signal tops the bed's
  // ripple at some onsets or none, at onsets across a period of the ripple and
  // at the first sample: one event each, where the hit alone peaks, its attack within 2 ms.
  for (const a of [0.8, 0.3, 0.2, 0.1]) {
    for (const at of [0, 0.3, 0.3031, 0.3063, 0.3094, 0.3125]) {
      const [quiet] = soundProfile(buffer48k(1, (t) => hit(t, at, a)), 48000).events;
      const found = soundProfile(buffer48k(1, (t) => 0.3 * Math.sin(2 * Math.PI * 40 * t) + hit(t, at, a)), 48000).events;
      assert.ok(found.length === 1 && Math.abs(found[0].seconds - quiet.seconds) <= 0.002 && Math.abs(found[0].attackMs - quiet.attackMs) <= 2,
        `a ${a} hit at ${at} s over a loud low bed: ${JSON.stringify(found.map((e) => [e.seconds, e.attackMs]))}, alone ${[quiet.seconds, quiet.attackMs]}`);
    }
  }
  // The same hit over a low hit's decaying tail, a 50 Hz hit at 0.9 with an
  // amplitude tau of 30 or 60 ms, then a 6 kHz hit at 0.1 or 0.05, 60 or 100 ms
  // later, outside the low hit's 50 ms and under its tail at 100 ms: two events.
  for (const tau of [0.03, 0.06]) {
    for (const [a, dt] of [[0.1, 0.06], [0.05, 0.06], [0.1, 0.1], [0.05, 0.1]]) {
      const found = soundProfile(buffer48k(1, (t) => hit(t, 0.2, 0.9, 50, tau) + hit(t, 0.2 + dt, a, 6000, 0.008)), 48000).events;
      assert.ok(found.length === 2 && found[0].seconds === 0.204 && Math.abs(found[1].seconds - 0.204 - dt) <= 0.002,
        `a ${a} 6 kHz hit ${dt} s after a 50 Hz hit with tau ${tau}: ${JSON.stringify(found.map((e) => [e.seconds, e.attackMs]))}`);
    }
  }
  // The first difference adds no event of its own: the bed starting at any
  // phase, its first sample 0 or 0.3, and the bed cut off, dropped to a third,
  // raised to three times its level, flipped in phase or cut to an equal 60 Hz
  // tone on a non-zero sample mid-track, one step in the first difference, are
  // no events, whether the whole signal's power falls, holds or rises across them.
  for (const phase of [0, Math.PI / 2]) {
    assert.deepEqual(soundProfile(buffer48k(1, (t) => 0.3 * Math.sin(2 * Math.PI * 40 * t + phase)), 48000).events, [], `a steady 40 Hz bed at phase ${phase}`);
  }
  for (const after of [0, 1 / 3, 3, -1]) {
    assert.deepEqual(soundProfile(buffer48k(1, (t) => (t < 0.5062 ? 1 : after) * 0.3 * Math.sin(2 * Math.PI * 40 * t)), 48000).events, [], `a 40 Hz bed stepping to ${after} of its level mid-track`);
  }
  assert.deepEqual(soundProfile(buffer48k(1, (t) => 0.3 * Math.sin(2 * Math.PI * (t < 0.5062 ? 40 : 60) * t)), 48000).events, [], 'a 40 Hz bed cut to a 60 Hz tone at its level mid-track');
  // A hit that starts abruptly over the bed is one event at either phase: on a
  // sample away from zero (cos) it opens with one step, as a cut does, and then sounds.
  for (const [hz, a] of [[1000, 0.1], [1000, 0.2], [500, 0.2]]) {
    for (const [phase, wave] of [['cos', Math.cos], ['sin', Math.sin]]) {
      const abrupt = soundProfile(buffer48k(1, (t) => 0.3 * Math.sin(2 * Math.PI * 40 * t) + (t < 0.3 ? 0 : a * Math.exp(-(t - 0.3) / 0.010) * wave(2 * Math.PI * hz * (t - 0.3)))), 48000).events;
      assert.ok(abrupt.length === 1 && Math.abs(abrupt[0].seconds - 0.3) < 0.01, `an abrupt ${hz} Hz hit at ${a}, ${phase} onset: events at ${JSON.stringify(abrupt.map((e) => e.seconds))}`);
    }
  }
  // A 250 Hz hit whose tail (power down 20 dB in 138 ms) is still within 20 dB of
  // the 4000 Hz hit 100 ms later: the second event starts where it rises out of the tail.
  const [, tailed] = soundProfile(buffer48k(1, (t) => hit(t, 0.2, 0.4, 250, 0.06) + hit(t, 0.3)), 48000).events;
  assert.ok(tailed.attackMs <= 10, `attack ${tailed.attackMs} ms after a tail`);
  assert.ok(tailed.octaves['4000'] >= 0.95 && tailed.octaves['250'] <= 0.05, `after a tail 4000 Hz holds ${tailed.octaves['4000']}, 250 Hz ${tailed.octaves['250']}`);
  assert.ok(Math.abs(tailed.centroidHz - 4000) <= 200, `centroid ${tailed.centroidHz} Hz after a tail`);
  // Sound already there at the track's start that holds its level is no event:
  // room tone 45 dB under two hits, or a steady bed. A hit that starts at the
  // first sample or a few ms in is one, as is a hit 30 ms in.
  let state = 7;
  const noise = () => { state = (state * 16807) % 2147483647; return (state / 2147483647) * 2 - 1; };
  const times = (events) => events.map((e) => e.seconds);
  assert.deepEqual(times(soundProfile(buffer48k(2, (t) => 0.0045 * noise() + hit(t, 0.5) + hit(t, 1.2)), 48000).events), [0.503, 1.204], 'room tone from the first sample');
  assert.deepEqual(times(soundProfile(buffer48k(1, (t) => 0.16 * Math.sin(2 * Math.PI * 200 * t) + hit(t, 0.5)), 48000).events), [0.503], 'a bed from the first sample');
  for (const [at, peak] of [[0, 0.004], [0.002, 0.005], [0.005, 0.009], [0.008, 0.011]]) {
    assert.deepEqual(times(soundProfile(buffer48k(1, (t) => hit(t, at) + hit(t, 0.5)), 48000).events), [peak, 0.503], `a hit ${at * 1000} ms in`);
  }
  const [first] = soundProfile(buffer48k(0.5, (t) => hit(t, 0, 0.8, 800, 0.05)), 48000).events;
  assert.ok(first && first.attackMs <= 6 && Math.abs(first.decayMs - 118) <= 3 && first.octaves['1000'] >= 0.9, `an 800 Hz one-shot from the first sample: ${JSON.stringify(first)}`);
  assert.deepEqual(times(soundProfile(buffer48k(1, (t) => hit(t, 0.03) + hit(t, 0.5)), 48000).events), [0.034, 0.503], 'a hit 30 ms in');
  // A hit at the first sample over a steady 200 Hz bed is measured over the
  // level it falls back to, as the same hit 300 ms in is, not over silence:
  // each octave's share within 0.02 of the later hit's.
  const bedTone = (t) => 0.16 * Math.sin(2 * Math.PI * 200 * t);
  const [atStart] = soundProfile(buffer48k(1, (t) => bedTone(t) + hit(t, 0)), 48000).events;
  const [later] = soundProfile(buffer48k(1, (t) => bedTone(t) + hit(t, 0.3)), 48000).events;
  assert.ok(atStart && later, 'both hits over the bed are events');
  for (const key of Object.keys(later.octaves)) {
    assert.ok(Math.abs(atStart.octaves[key] - later.octaves[key]) <= 0.02, `${key} Hz: ${atStart.octaves[key]} at the first sample, ${later.octaves[key]} 300 ms in`);
  }
  // A long one-shot trimmed to its hit, an 800 Hz decay with tau 0.5 s (power
  // down 8.7 dB in 500 ms), is an event, while a bed or noise that holds 1 s and
  // then fades out is none.
  const [long] = soundProfile(buffer48k(2, (t) => hit(t, 0, 0.8, 800, 0.5)), 48000).events;
  assert.ok(long && long.seconds <= 0.006 && Math.abs(long.decayMs - 1154) <= 10 && long.octaves['1000'] >= 0.9, `a long one-shot from the first sample: ${JSON.stringify(long)}`);
  // The same long one-shot over a 200 Hz bed (falling back into it after
  // about 1.3 s) is measured at the first sample as it is 300 ms in: its decay
  // and octave shares alike, its attack within 1 ms.
  const quietBed = (t) => 0.05 * Math.sin(2 * Math.PI * 200 * t);
  const [longStart] = soundProfile(buffer48k(2, (t) => quietBed(t) + hit(t, 0, 0.8, 800, 0.5)), 48000).events;
  const [longLater] = soundProfile(buffer48k(2.3, (t) => quietBed(t) + hit(t, 0.3, 0.8, 800, 0.5)), 48000).events;
  assert.ok(longStart && longLater && Math.abs(longStart.attackMs - longLater.attackMs) <= 1 && longStart.decayMs === longLater.decayMs, `a long one-shot over a bed: ${JSON.stringify(longStart)} at the first sample, ${JSON.stringify(longLater)} 300 ms in`);
  for (const key of Object.keys(longLater.octaves)) {
    assert.ok(Math.abs(longStart.octaves[key] - longLater.octaves[key]) <= 0.02, `${key} Hz: ${longStart.octaves[key]} at the first sample, ${longLater.octaves[key]} 300 ms in`);
  }
  // A hit at the first sample followed by a second before the first has fallen
  // 12 dB, a flam (800 Hz, tau 60 ms, then 30 ms at 0.1 s), or by three more
  // 90 ms apart, a roll, alone or over the bed: the first hit is still an event,
  // and over the bed each hit of the roll is one, as it is alone.
  const flam = (t) => burst(t, 0, 800, 0.8, 0.06) + burst(t, 0.1, 800, 0.5, 0.03);
  const roll = (t) => [0, 0.09, 0.18, 0.27].reduce((sum, at) => sum + burst(t, at, 800, 0.8, 0.04), 0);
  assert.deepEqual(times(soundProfile(buffer48k(1, flam), 48000).events), [0.004], 'a flam at the first sample');
  assert.deepEqual(times(soundProfile(buffer48k(1, (t) => bedTone(t) + flam(t)), 48000).events), [0.004], 'a flam at the first sample over a bed');
  assert.deepEqual(times(soundProfile(buffer48k(1, (t) => bedTone(t) + roll(t)), 48000).events), [0.004, 0.095, 0.184, 0.275], 'a roll at the first sample over a bed');
  const fade = (t) => (t < 1 ? 1 : Math.max(0, 2 - t));
  assert.deepEqual(times(soundProfile(buffer48k(2.5, (t) => fade(t) * bedTone(t)), 48000).events), [], 'a bed that holds, then fades');
  assert.deepEqual(times(soundProfile(buffer48k(2.5, (t) => fade(t) * 0.2 * noise()), 48000).events), [], 'noise that holds, then fades');
  // A bed that fades steadily from its first sample, over 2, 5 or 20 s, falls
  // 12 dB from its peak, so it counts as one event at the start, its decay
  // ending 20 dB under the peak, at 90% of the fade.
  for (const s of [2, 5, 20]) {
    const events = soundProfile(buffer48k(s, (t) => (1 - t / s) * bedTone(t)), 48000).events;
    assert.deepEqual(events.map((e) => [e.seconds, e.decayMs]), [[0.002, s * 900]], `a bed fading out over ${s} s from the first sample`);
  }
});

test('contact sheet: --sound-reference needs --sound, --json and a sound file', async (t) => {
  assert.deepEqual(parseArgs(['readout', '--frames', '3', '--sound', '--json', '--sound-reference', 'ref.mp3']).soundReference, { file: 'ref.mp3' });
  assert.equal('soundReference' in parseArgs(['readout', '--frames', '3', '--sound', '--json']), false, 'without it the args are unchanged');
  const strip = ['readout', '--frames', '3'];
  const refusals = [
    [[...strip, '--sound', '--json', '--sound-reference', 'ref.txt'], '--sound-reference needs a sound file: .wav, .mp3, .m4a, .aac, .ogg, .opus or .flac, got ref.txt'],
    [[...strip, '--sound', '--json', '--sound-reference'], '--sound-reference needs a sound file: .wav, .mp3, .m4a, .aac, .ogg, .opus or .flac, got nothing'],
    [[...strip, '--sound', '--json', '--sound-reference', 'a.wav', '--sound-reference', 'b.wav'], 'use --sound-reference only once'],
    [[...strip, '--json', '--sound-reference', 'a.wav'], '--sound-reference is measured beside the strip\'s soundtrack; add --sound'],
    [[...strip, '--sound', '--sound-reference', 'a.wav'], '--sound-reference reports its profile in the sheet\'s JSON; add --json'],
  ];
  for (const [bad, cause] of refusals) {
    await t.test(bad.join(' '), () => assert.throws(() => parseArgs(bad), { message: `seeds: ${cause}\n${USAGE}` }));
  }
});

test('contact sheet: soundProfile serialized after SOUND_HELPERS runs alone and matches the direct call', () => {
  const channels = twoBursts();
  const alone = new Function(`${SOUND_HELPERS}\nreturn (${soundProfile.toString()});`)();
  assert.equal(JSON.stringify(alone(channels, 48000)), JSON.stringify(soundProfile(channels, 48000)));
});

test('contact sheet: levelText says the film export\'s level, and runs alone as the page serializes it', () => {
  const alone = new Function(`return (${levelText.toString()});`)();
  for (const [level, said] of [
    [{ lufs: null, gain: 0, limited: 0 }, 'silent, kept as rendered'],
    [{ lufs: -14, gain: 3.2, limited: 0 }, 'gain 3.2 dB, -14 LUFS'],
    [{ lufs: -14.1, gain: 9.5, limited: 4.6 }, 'gain 9.5 dB, limited by up to 4.6 dB, -14.1 LUFS'],
  ]) {
    assert.equal(levelText(level), said);
    assert.equal(alone(level), said);
  }
  assert.match(page(['readout'], 3, 1, [], null, null, { frames: 3, sound: true }), /levelText\(L\)/);
});

test('contact sheet: failureText names each distinct error with the cells it hit, at most three', () => {
  const cell = (seed, frame, error) => ({ name: 'p', seed, frame, seconds: frame / 24, error });
  const strip = { strip: { hz: 24 }, cells: [cell(1, 0, 'a'), cell(1, 12, null), cell(1, 24, 'a'), cell(1, 36, 'b')] };
  assert.deepEqual(failureText(strip), ['failed: a -- p seed 1 frame 0 (0.000 s), p seed 1 frame 24 (1.000 s)', 'failed: b -- p seed 1 frame 36 (1.500 s)']);
  const sweep = { strip: null, cells: ['a', 'b', 'c', 'd', 'e'].map((e, i) => ({ name: 'p', seed: i + 1, error: e })), sound: { error: 's' } };
  assert.deepEqual(failureText(sweep), ['failed: a -- p seed 1', 'failed: b -- p seed 2', 'failed: c -- p seed 3', '... and 3 more distinct errors; --json gives each cell\'s in cells[].error']);
  assert.deepEqual(failureText({ strip: null, cells: [], sound: { error: 'no sound' } }), ['failed: no sound -- the soundtrack']);
  // A --param sweep draws every cell at one seed: its values tell the failed cells apart.
  const swept = { strip: null, cells: [0.25, 0.5, 0.75].map((x) => ({ name: 'p', seed: 1, params: { x, mode: 'a' }, error: x > 0.3 ? 'a' : null })) };
  assert.deepEqual(failureText(swept), ['failed: a -- p seed 1 x=0.5 mode=a, p seed 1 x=0.75 mode=a']);
});

test('contact sheet: the --sound strip page\'s sound functions run alone and match the direct calls', () => {
  // The source the page puts between stripFlags and its main function, run with nothing else.
  const html = page(['readout'], 3, 1, [], null, null, { frames: 3, sound: true });
  const from = html.indexOf(stripFlags.toString()) + stripFlags.toString().length, to = html.indexOf('(function () {\n  var req');
  assert.ok(from > 0 && to > from, 'the page holds its sound code after stripFlags');
  const run = new Function(`${html.slice(from, to)}\nreturn function (channels) { return [soundPicture(channels, 48000, 50, 96), soundProfile(channels, 48000)]; };`)();
  const channels = twoBursts();
  const alone = JSON.stringify(run(channels)), direct = JSON.stringify([soundPicture(channels, 48000, 50, 96), soundProfile(channels, 48000)]);
  // Compared by equality and length, so a failure prints no large value.
  assert.ok(alone === direct, `standalone ${alone.length} characters, direct ${direct.length}`);
});

test('contact sheet: --sound-reference is decoded in Edge and measured as the soundtrack is, and nothing of it is kept', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-sound-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'x.wav');
  fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
  const channels = twoBursts();
  // The page's expressions run in one context standing in for Edge, whose decoder hands back the two bursts.
  const edgeWith = (decode) => async (html, options, work) => {
    assert.deepEqual([...options.file], [1, 2, 3, 4], 'the file reaches the page only as the bytes served at /file');
    const context = vm.createContext({
      location: { protocol: 'http:' }, document: { readyState: 'complete' },
      fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }),
      OfflineAudioContext: class { decodeAudioData() { return decode(); } },
    });
    const client = { send: async (method, { expression }) => ({ result: { value: await vm.runInContext(expression, context) } }) };
    return work(client, { errors: [], phase: null });
  };
  const decoded = { numberOfChannels: 2, sampleRate: 48000, length: 48000, duration: 1, getChannelData: (i) => channels[i] };
  const sound = await measureSound(file, undefined, edgeWith(async () => decoded));
  assert.deepEqual(sound, { file: 'x.wav', bytes: 4, seconds: 1, rate: 48000, channels: 2, profile: soundProfile(channels, 48000) });
  await assert.rejects(measureSound(file, undefined, edgeWith(async () => { throw new Error('Unable to decode audio data'); })),
    /^Error: seeds: --sound-reference cannot decode x\.wav: Unable to decode audio data\n/);
  await assert.rejects(measureSound(file, undefined, edgeWith(async () => ({ ...decoded, length: 0, duration: 0, getChannelData: () => new Float32Array(0) }))),
    /^Error: seeds: --sound-reference x\.wav holds no samples\n/);
  await assert.rejects(measureSound(path.join(dir, 'missing.wav'), undefined, edgeWith(async () => decoded)), /--sound-reference cannot read .*missing\.wav: ENOENT/);
  // The strip page carries those numbers into window.__sheet.sound.reference, even when its soundtrack fails.
  const reference = { ...sound, file: 'a</script>.wav' };
  for (const fails of [false, true]) {
    const { Context } = fakeAudio();
    const html = page(['readout'], 3, 1, [], null, null, { frames: 3, sound: true }, null, null, null, reference);
    assert.doesNotMatch(html, /a<\/script>/, 'the file name cannot close the page script');
    const { window } = runStrip({ frames: 3, sound: true }, { OfflineAudioContext: fails ? class { constructor() { throw new Error('no audio'); } } : Context, Promise, Float32Array, Float64Array, Math },
      'readout', [], 3, null, null, null, null, null, reference);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(window.__sheet.sound.error !== null, fails, String(window.__sheet.sound.error));
    assert.deepEqual(JSON.parse(JSON.stringify(window.__sheet.sound.reference)), reference, fails ? 'a failed soundtrack' : 'a drawn soundtrack');
  }
});

// A film whose state keeps contact lists and whose two squares swap paint
// order on odd frames, loaded as the page loads an external piece.
const TOUCHING = path.join(__dirname, 'fixtures', 'touching-film.cjs');
const touchingExternal = () => loadExternal(TOUCHING);
const touching = () => validate(touchingExternal().piece);

test('contact sheet: --contacts shows two frames before to three after each contact of a list in the built state, each contact starting a row', () => {
  const args = parseArgs(['stride', '--contacts', 'falls', '--png']);
  assert.deepEqual(args.strip, { frames: null, at: null, scale: null, loupe: null, shots: false, sound: false, contacts: 'falls' });
  const p = validate(EXAMPLES.stride);
  const falls = solve(p, p.seed).state.falls;
  assert.deepEqual(contactList(p, 'falls'), falls.map((f) => ({ frame: f.frame, count: 1, point: { x: f.x, y: f.y } })), 'one entry a fall, in frame order, at its heel');
  const strip = planStrip(p, args.strip);
  assert.deepEqual(CONTACT_WINDOW, [-2, -1, 0, 1, 2, 3]);
  assert.deepEqual(strip.cells.map((cell) => [cell.contact, cell.offset, cell.frame]),
    falls.flatMap((f, k) => CONTACT_WINDOW.map((d) => [k + 1, d, f.frame + d])), 'every fall is at least two frames in and three from the end');
  assert.equal(strip.contacts, falls.length);
  assert.equal(strip.columns, 3, 'three 640-pixel cells to a row, so a contact takes two rows');
  assert.equal(planStrip(p, { contacts: 'falls', scale: 0.3 }).columns, 6, 'narrower cells put a whole contact on one row');
  assert.equal(sheetStem(['stride'], [], null, null, args.strip), path.join(__dirname, '..', 'out', 'stride-contacts-falls'));
  assert.equal(sheetStem(['cues'], [], null, null, { contacts: 'cues.hits', seed: 7 }), path.join(__dirname, '..', 'out', 'cues-contacts-cues.hits-seed7'), 'each list has a strip of its own');
  // Lists whose names differ only in case write files whose names differ in more
  // than case, so neither replaces the other on Windows or default macOS.
  const folded = ['falls', 'Falls', 'FALLS', 'cues.Hits'].map((key) => path.basename(sheetStem(['stride'], [], null, null, { contacts: key })).toLowerCase());
  assert.equal(new Set(folded).size, 4, `case-folded stems collide: ${folded.join(', ')}`);
  assert.equal(folded[0], 'stride-contacts-falls', 'an all-lowercase list keeps its plain name');
  const cues = validate(EXAMPLES.cues);
  assert.deepEqual(contactList(cues, 'cues.hits').map((c) => c.frame), solve(cues, cues.seed).state.cues.hits.map((h) => h.frame), 'a dotted path reaches a nested list');
  const t = touching();
  assert.deepEqual(contactList(t, 'cues.contacts'), [{ frame: 3, count: 2, point: { x: 100, y: 100 } }, { frame: 12, count: 1, point: { x: 900, y: 600 } }],
    'contacts on one frame are one entry, with the first point');
  assert.deepEqual(contactList(t, 'pointed'), [{ frame: 5, count: 2, point: { x: 900, y: 600 } }], 'a frame whose first contact has no point takes the first point among its contacts');
  assert.deepEqual(planStrip(t, { contacts: 'late' }).cells.map((cell) => [cell.offset, cell.frame]), [[-2, 21], [-1, 22], [0, 23]], 'a contact on the last frame shows only the frames that exist');
  // Contacts on the first, a middle and the last frame: each starts a grid row,
  // its contact frame in the column it holds in a whole contact.
  const ends = planStrip(t, { contacts: 'ends' });
  assert.equal(ends.columns, 3);
  assert.deepEqual(ends.cells.map((cell) => [cell.contact, cell.offset, cell.column]),
    [[1, 0, 3], [1, 1, undefined], [1, 2, undefined], [1, 3, undefined], [2, -2, 1], [2, -1, undefined], [2, 0, undefined], [2, 1, undefined], [2, 2, undefined], [2, 3, undefined], [3, -2, 1], [3, -1, undefined], [3, 0, undefined]],
    'a contact cut short by the start begins at column 3, so the next contact begins a new row');
  assert.deepEqual(planStrip(t, { contacts: 'ends', scale: 0.3 }).cells.filter((cell) => cell.column).map((cell) => cell.column), [3, 1, 1], 'at six columns the same columns');
  assert.ok(strip.cells.every((cell, i) => cell.column === (cell.offset === -2 ? 1 : undefined)), 'a whole contact starts at column 1');
  const html = page(['cues'], 0, 1, [], null, null, { contacts: 'cues.hits' });
  assert.match(html, /'contact ' \+ cell\.contact \+ \(cell\.offset < 0/);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
  const { elements } = runStrip({ contacts: 'cues.hits' }, {}, 'cues');
  const labels = elements.filter((el) => el.className === 'values').map((el) => el.textContent);
  assert.deepEqual(labels.slice(0, 6).map((l) => l.split(' · ')[0]), ['contact 1, 2 before', 'contact 1, 1 before', 'contact 1', 'contact 1, 1 after', 'contact 1, 2 after', 'contact 1, 3 after']);
  assert.match(labels[2], /^contact 1 · frame 4 · 0\.167 s$/);
  assert.match(elements.find((el) => el.className === 'note').textContent, / 42 shown around 7 contact frames at seed /);
  const figures = elements.filter((el) => el.tag === 'figure' && el.children.some((c) => c.tag === 'canvas'));
  assert.deepEqual(figures.map((el) => el.style.gridColumnStart), labels.map((_, i) => (i % 6 ? undefined : 1)), 'each contact\'s first figure starts a grid row');
});

test('contact sheet: the strip page crops each contact cell around its contact and places a cut-short contact in its column', () => {
  const external = touchingExternal();
  // A small cell keeps the draws cheap; the crop and note numbers come from the tool's own plan.
  const small = { scale: 0.1 };
  const plan = planStrip(touching(), { contacts: 'cues.contacts', loupe: true, ...small });
  const { w, h, W, H } = plan.loupe;
  assert.deepEqual([plan.width, plan.height, W, H], [96, 64, 1920, 1280]);
  const { elements, draws } = runStrip({ contacts: 'cues.contacts', loupe: true, ...small }, {}, 'touching', [], 0, external);
  // The film canvas is 1920 wide; each cell's crop is the nine-argument drawImage from it.
  const crops = draws.filter((d) => d.args.length === 9 && d.args[0].width === W).map((d) => d.args.slice(1));
  assert.equal(crops.length, 12, 'six cells a contact, two contacts');
  // Around (100, 100) and (900, 600) at the film's scale 2, a crop w x h centred there, held inside the frame.
  assert.deepEqual(crops, [...Array(6).fill([200 - w / 2, 200 - h / 2, w, h, 0, 0, w, h]), ...Array(6).fill([1800 - w / 2, 1200 - h / 2, w, h, 0, 0, w, h])],
    'the first contact\'s cells are cut around (100, 100), the second\'s around (900, 600), both held inside the frame');
  const captions = elements.filter((el) => el.tag === 'figcaption' && typeof el.textContent === 'string' && el.textContent.startsWith('100% of'));
  assert.equal(captions.filter((el) => el.textContent.endsWith('around the contact at (100, 100)')).length, 6);
  assert.equal(captions.filter((el) => el.textContent.endsWith('around the contact at (900, 600)')).length, 6);
  const note = elements.find((el) => el.className === 'note').textContent;
  assert.match(note, new RegExp(` 12 shown around 2 contact frames at seed 1, ${plan.width} px wide \\(scale ${plan.scale}\\), each with a 100% crop of the ${W} × ${H} film around each contact’s point, or \\(480, 320\\) for a contact without one · `));
  const plain = runStrip({ contacts: 'ends', loupe: true, ...small }, {}, 'touching', [], 0, external);
  assert.match(plain.elements.find((el) => el.className === 'note').textContent, /film around \(480, 320\) · /, 'no contact with a point, no mention of one');
  const figures = plain.elements.filter((el) => el.tag === 'figure' && el.children.some((c) => c.tag === 'canvas'));
  assert.deepEqual(figures.map((el) => el.style.gridColumnStart), [3, undefined, undefined, undefined, 1, undefined, undefined, undefined, undefined, undefined, 1, undefined, undefined]);
  assert.equal(plain.draws.filter((d) => d.args.length === 9 && d.args[0].width === W).length, 13, 'every cell of a contact without a point is cropped at the centre');
  // --loupe x,y names the author's point: every cell is cut there and no caption names a contact's point.
  const named = runStrip({ contacts: 'cues.contacts', loupe: { x: 10, y: 10 }, ...small }, {}, 'touching', [], 0, external);
  assert.deepEqual([...new Set(named.draws.filter((d) => d.args.length === 9 && d.args[0].width === W).map((d) => JSON.stringify(d.args.slice(1))))], [JSON.stringify([0, 0, w, h, 0, 0, w, h])]);
  const namedCaptions = named.elements.filter((el) => el.tag === 'figcaption' && typeof el.textContent === 'string' && el.textContent.startsWith('100% of'));
  assert.equal(namedCaptions.length, 12);
  assert.ok(namedCaptions.every((el) => !el.textContent.includes('around the contact at')), 'a crop cut around the named point names no contact');
});

test('contact sheet: --contacts refuses a list it cannot show, by name', () => {
  const cascade = validate(EXAMPLES.cascade), t = touching();
  const hits = solve(cascade, cascade.seed).state.hits, onFrames = new Set(hits.map((h) => h.frame)).size;
  assert.ok(onFrames > MAX_CONTACTS);
  assert.throws(() => contactList(cascade, 'hits'), new RegExp(`--contacts hits lists ${hits.length} contacts on ${onFrames} frames, and a strip shows up to ${MAX_CONTACTS} contact frames; name a shorter list, such as the planned contacts, or pick frames with --at`));
  assert.throws(() => contactList(cascade, 'nothing'), /--contacts nothing names nothing in cascade's built state; name a list of contacts, each on a frame or at seconds/);
  assert.throws(() => contactList(cascade, 'bodies'), /--contacts bodies names no list in cascade's built state/);
  assert.throws(() => contactList(t, 'cues.shots'), /--contacts cues\.shots: entry \[0\] has no whole frame or finite seconds/);
  assert.throws(() => contactList(t, 'broken'), /--contacts broken: entry \[1\] has no whole frame or finite seconds/);
  assert.throws(() => contactList({ ...t, time: { ...t.time, duration: 1 } }, 'late'), /--contacts late: entry \[0\] is on frame 23, outside touching's 12 frames/);
  assert.throws(() => planStrip(validate(EXAMPLES.specimen), { contacts: 'x' }), /specimen is a still; a time strip needs a timeline/);
  for (const bad of [['stride', '--contacts'], ['stride', '--contacts', '--png'], ['stride', '--contacts', 'a b']]) {
    assert.throws(() => parseArgs(bad), /--contacts needs the name of a list in the built state, dotted for a nested one, such as falls or cues\.hits/, bad.join(' '));
  }
  assert.throws(() => parseArgs(['stride', '--contacts', 'falls', '--contacts', 'falls']), /use --contacts only once/);
  for (const bad of [['--frames', '3'], ['--at', '1'], ['--shots']]) {
    assert.throws(() => parseArgs(['stride', '--contacts', 'falls', ...bad]), /--contacts shows the frames around each contact; drop --frames, --at or --shots/, bad.join(' '));
  }
});

test('contact sheet: --contacts with --loupe crops each cell around its contact, unless --loupe names a point', () => {
  const t = touching();
  const around = planStrip(t, { contacts: 'cues.contacts', loupe: true });
  assert.deepEqual(around.loupe, { x: 480, y: 320, scale: 2, W: 1920, H: 1280, w: 640, h: 427, sx: 640, sy: 427 }, 'the strip keeps the centre crop for a contact without a point');
  const first = around.cells.filter((cell) => cell.contact === 1), second = around.cells.filter((cell) => cell.contact === 2);
  assert.deepEqual(first.map((cell) => cell.loupe), first.map(() => ({ sx: 0, sy: 0 })), 'a crop around (100, 100) at scale 2 is held inside the frame');
  assert.deepEqual([...new Set(second.map((cell) => JSON.stringify(cell.loupe)))], ['{"sx":1280,"sy":853}'], 'a crop around (900, 600) is held inside the far corner');
  assert.deepEqual(first.map((cell) => cell.point), first.map(() => ({ x: 100, y: 100 })));
  assert.ok(planStrip(t, { contacts: 'cues.contacts', loupe: { x: 10, y: 10 } }).cells.every((cell) => cell.loupe === undefined), 'a named point is the author\'s choice');
  assert.ok(planStrip(t, { contacts: 'late', loupe: true }).cells.every((cell) => cell.loupe === undefined && cell.point === undefined), 'no point, no crop of its own');
  const html = page(['readout'], 3, 1, [], null, null, { frames: 3, loupe: true });
  assert.match(html, /sx = cell\.loupe \? cell\.loupe\.sx : L\.sx/);
  assert.match(html, /around the contact at \(/);
});

test('contact sheet: --contacts reads a simulation\'s contact log kept in the built state, each impact a contact with a crop around its point', () => {
  const { simulate } = require('../core/sim.js');
  // Two discs dropped onto a floor, the second held for half a second: each
  // lands and bounces once more, four impacts on four frames.
  const p = validate({
    name: 'drops', size: { w: 600, h: 400 }, seed: 1, time: { duration: 2, hz: 24 },
    build: [['fall', (s) => {
      s.run = simulate({
        frames: 48, hz: 24, gravity: [0, 900], restitution: 0.3, quiet: 120,
        particles: [{ x: 200, y: 50, radius: 10 }, { x: 400, y: 100, radius: 10, hold: 0.5 }],
        walls: [{ from: [0, 250], to: [600, 250] }],
      });
    }]],
    draw(g, s, t, clock) { for (let i = 0; i < 2; i++) { const [x, y] = s.run.at(clock.frame, i); g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill(); } },
  });
  const log = solve(p, p.seed).state.run.contacts;
  assert.deepEqual(log.map((c) => [c.a, c.wall, c.x, c.y]), [[0, 0, 200, 250], [0, 0, 200, 250], [1, 0, 400, 250], [1, 0, 400, 250]], 'each disc lands on the floor and bounces once more');
  const list = contactList(p, 'run.contacts');
  assert.deepEqual(list, log.map((c) => ({ frame: c.frame, count: 1, point: { x: c.x, y: c.y } })), 'one contact an impact, on the frame that first shows it, at its point');
  assert.deepEqual(list.map((c) => c.frame), [16, 25, 26, 34]);
  const strip = planStrip(p, { contacts: 'run.contacts', loupe: true });
  assert.equal(strip.contacts, 4);
  assert.deepEqual(strip.cells.map((cell) => [cell.contact, cell.frame]), list.flatMap((c, k) => CONTACT_WINDOW.map((d) => [k + 1, c.frame + d])),
    'the frames around two impacts one frame apart are each shown in their own row');
  const { scale, w, h } = strip.loupe;
  assert.equal(scale, 3.2);
  assert.deepEqual(strip.cells.map((cell) => [cell.point, cell.loupe]), list.flatMap((c) => CONTACT_WINDOW.map(() => [c.point, { sx: Math.round(c.point.x * scale - w / 2), sy: Math.round(c.point.y * scale - h / 2) }])),
    'every cell is cropped centred on its impact, which lies inside the frame');
  assert.deepEqual([...new Set(strip.cells.map((cell) => JSON.stringify(cell.loupe)))], ['{"sx":320,"sy":587}', '{"sx":960,"sy":587}']);
});

test('contact sheet: recordMarks lists each paint call in order with its style, width, box and starts in surface units', () => {
  const marks = recordMarks({ w: 100, h: 100 }, (g) => {
    g.save(); g.translate(10, 10); g.scale(2, 2);
    g.strokeStyle = '#111'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(10, 10); g.stroke();
    g.fillStyle = 'red'; g.fillRect(5, 5, 10, 10);
    g.lineTo(0, 12); g.stroke();
    g.beginPath(); g.arc(20, 20, 5, 0, 7); g.fill();
    g.beginPath(); g.moveTo(1, 1); g.quadraticCurveTo(2, 2, 3, -30); g.moveTo(4, 4); g.stroke();
    g.drawImage({ width: 4, height: 4 }, 30, 30);
    g.fillText('x', 50, 50);
    g.beginPath(); g.fill();
    g.restore();
  });
  assert.deepEqual(marks, [
    { index: 0, op: 'stroke', style: '#111', width: 4, box: [8, 8, 32, 32], starts: [[10, 10]], composite: 'source-over' },
    { index: 1, op: 'fillRect', style: 'red', width: 0, box: [20, 20, 40, 40], starts: [], composite: 'source-over' },
    { index: 2, op: 'stroke', style: '#111', width: 4, box: [8, 8, 32, 36], starts: [[10, 10]], composite: 'source-over' },
    { index: 3, op: 'fill', style: 'red', width: 0, box: [40, 40, 60, 60], starts: [], composite: 'source-over' },
    { index: 4, op: 'stroke', style: '#111', width: 4, box: [10, -52, 20, 20], starts: [[12, 12], [18, 18]], composite: 'source-over' },
    { index: 5, op: 'drawImage', style: null, width: 0, box: [70, 70, 78, 78], starts: [], composite: 'source-over' },
    { index: 6, op: 'fillText', style: 'red', width: 0, box: [110, 110, 110, 110], starts: [], composite: 'source-over' },
  ], 'a rectangle or raster call leaves the path being built alone, and an empty path paints nothing');
  // An arc or an ellipse spans only the points its sweep passes, not its whole circle.
  const swept = recordMarks({ w: 100, h: 100 }, (g) => {
    g.lineWidth = 2;
    g.beginPath(); g.arc(50, 50, 10, Math.PI, 2 * Math.PI); g.stroke();
    g.beginPath(); g.arc(50, 50, 10, 0, Math.PI / 2); g.fill();
    g.beginPath(); g.arc(50, 50, 10, 0, Math.PI / 2, true); g.fill();
    g.beginPath(); g.ellipse(50, 50, 20, 10, 0, 0, Math.PI); g.fill();
    g.save(); g.translate(50, 50);
    g.beginPath(); g.ellipse(0, 0, 20, 5, Math.PI / 2, 0, 2 * Math.PI); g.fill();
    g.rotate(Math.PI / 2); g.beginPath(); g.arc(0, 0, 10, 0, Math.PI / 2); g.fill();
    g.restore();
  }).map((m) => m.box.map((v) => Math.round(v * 1e6) / 1e6 + 0));
  assert.deepEqual(swept, [
    [39, 39, 61, 51], [50, 50, 60, 60], [40, 40, 60, 60], [30, 50, 70, 60], [45, 30, 55, 70], [40, 50, 50, 60],
  ], 'a brow arc, a quarter, its anticlockwise complement, a half ellipse, a rotated ellipse and an arc under a rotation');
  // The raster state a vector surface refuses is taken, scoped by save and
  // restore, and each mark keeps the composite mode it was painted with.
  const composited = recordMarks({ w: 100, h: 100 }, (g) => {
    g.font = 'bold 20px serif';
    assert.deepEqual(g.measureText('abc'), { width: 36 }, 'a stand-in width from the font size');
    g.save();
    g.globalCompositeOperation = 'destination-over'; g.filter = 'blur(2px)'; g.shadowBlur = 6; g.shadowOffsetX = 2; g.shadowOffsetY = -2;
    assert.equal(g.globalCompositeOperation, 'destination-over'); assert.equal(g.shadowBlur, 6);
    g.fillStyle = g.createPattern({ width: 2, height: 2 }, 'repeat'); g.fillRect(0, 0, 10, 10);
    g.fillStyle = g.createConicGradient(0, 50, 50); g.fillStyle.addColorStop(0, 'red'); g.fillRect(10, 10, 10, 10);
    g.restore();
    assert.equal(g.globalCompositeOperation, 'source-over'); assert.equal(g.filter, 'none'); assert.equal(g.shadowOffsetY, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'blue'; g.fillRect(20, 20, 10, 10);
  });
  assert.deepEqual(composited.map((m) => [m.composite, m.style && m.style.pattern ? 'pattern' : m.style && m.style.stops ? 'gradient' : m.style]),
    [['destination-over', 'pattern'], ['destination-over', 'gradient'], ['multiply', 'blue']]);
  // The site's style demos that composite or cast shadows read too.
  for (const [name, mode] of [['light-painting', 'lighter'], ['papercraft', 'source-over']]) {
    const style = validate(require(path.join(__dirname, '..', 'site', 'demos', name + '.js'))), ss = solve(style, style.seed);
    const modes = recordMarks(style.size, (g) => drawFrame(g, style, ss, playheads(style)[0])).map((m) => m.composite);
    assert.ok(modes.length > 100 && modes.includes(mode), `${name}: ${modes.length} marks, ${[...new Set(modes)]}`);
  }
  // A raster-only piece: pixel-field clears nothing but creates and puts pixels.
  const pf = validate(EXAMPLES['pixel-field']), solved = solve(pf, pf.seed);
  const raster = recordMarks(pf.size, (g) => {
    g.clearRect(0, 0, pf.size.w, pf.size.h);
    assert.equal(g.getImageData(0, 0, 2, 3).data.length, 24, 'read back as transparent pixels');
    drawFrame(g, pf, solved, playheads(pf)[0]);
  });
  assert.deepEqual(raster.map((m) => [m.op, m.box]), [['putImageData', [0, 0, pf.size.w, pf.size.h]]], 'the frame is one putImageData the size of the surface');
  // A sprite finds no canvas and paints its marks one by one.
  const sprites = loadExternal(path.join(__dirname, 'fixtures', 'sprite-film.cjs')).piece, sp = validate(sprites), ss = solve(sp, sp.seed);
  const ops = recordMarks(sp.size, (g) => drawFrame(g, sp, ss, playheads(sp)[1])).map((m) => m.op);
  assert.ok(ops.length > 60 && !ops.includes('drawImage') && ops.includes('fill') && ops.includes('stroke'), `${ops.length} marks, ${new Set(ops).size} kinds`);
});

test('contact sheet: paintOrder counts each thing\'s marks behind and in front of another where they meet, and layerSwaps names the frames that mix or swap them', () => {
  const box = (x, y) => [x, y, x + 10, y + 10];
  const marks = [
    { index: 0, op: 'fill', style: 'a', box: box(0, 0) }, { index: 1, op: 'fill', style: 'b', box: box(5, 5) },
    { index: 2, op: 'fill', style: 'a', box: box(8, 8) }, { index: 3, op: 'fill', style: 'a', box: box(50, 50) },
    { index: 4, op: 'fill', style: 'c', box: box(0, 0) },
  ];
  const things = { a: (m) => m.style === 'a', b: (m) => m.style === 'b', c: (m) => m.style === 'c' };
  assert.deepEqual(paintOrder(marks, things), {
    'a/b': { behind: 1, front: 1, mixed: true }, 'a/c': { behind: 2, front: 0, mixed: false }, 'b/c': { behind: 1, front: 0, mixed: false },
  }, 'the mark at (50, 50) meets no mark of another thing and says nothing');
  assert.deepEqual(paintOrder(marks, { b: things.b, bc: (m) => m.style !== 'a' }), { 'b/bc': { behind: 1, front: 0, mixed: false } },
    'a mark both tests pick is not compared with itself');
  const under = marks.map((m) => (m.style === 'b' ? { ...m, composite: 'destination-over' } : m));
  assert.deepEqual(paintOrder(under, things)['a/b'], { behind: 0, front: 2, mixed: false }, 'a destination-over mark goes under the source-over marks it meets, painted before or after it');
  assert.deepEqual(paintOrder(under.map((m) => ({ ...m, composite: 'destination-over' })), things)['a/b'], { behind: 1, front: 1, mixed: true },
    'between destination-over marks the earlier one is in front');
  const t = touching(), solved = solve(t, t.seed);
  const squares = { red: (m) => m.style === '#f00', blue: (m) => m.style === '#00f', green: (m) => m.style === '#0f0' };
  assert.deepEqual(layerSwaps(t, solved, [0, 2, 4], squares), [], 'the same order on every frame shown');
  assert.deepEqual(layerSwaps(t, solved, [0, 1, 3, 4], squares), [
    { frame: 1, pair: 'red/blue', behind: 0, front: 1, why: 'swapped' }, { frame: 4, pair: 'red/blue', behind: 1, front: 0, why: 'swapped' },
  ], 'a side change is named on the frame it shows, and the green square meets neither');
});

test('test fake canvas: reset() clears the pixels and returns the styles to their defaults, as a browser\'s does', () => {
  const ctx = fakeCanvas({ width: 4, height: 4 }, nullSurface).getContext('2d');
  ctx.fillStyle = '#f00'; ctx.globalAlpha = 0.5; ctx.fillRect(0, 0, 4, 4);
  assert.equal(ctx.canvas.pixels.some((v) => v), true, 'the fill painted');
  ctx.reset();
  assert.equal(ctx.canvas.pixels.some((v) => v), false, 'reset() left pixels painted');
  assert.deepEqual([ctx.fillStyle, ctx.globalAlpha], ['#000000', 1]);
});

test('contact sheet: partCover gives each named part its share of the frame and the share marks drawn after it cover', () => {
  // Frame 0 paints red, then blue over red's right half; odd frames swap them. Green stands apart.
  const ctx = fakeCanvas({ width: 960, height: 640 }, nullSurface).getContext('2d');
  const t = touching(), solved = solve(t, t.seed);
  const draw = (f) => (g) => drawFrame(g, t, solved, playheads(t)[f]);
  const parts = [{ name: 'red', styles: ['#f00'] }, { name: 'blue', styles: ['#00f'] }, { name: 'green', styles: ['#0f0'] }, { name: 'none', styles: ['#123456'] }];
  assert.deepEqual(partCover(ctx, draw(0), parts), [
    { name: 'red', share: 0.0651, covered: 0.5 }, { name: 'blue', share: 0.0651, covered: 0 },
    { name: 'green', share: 0.0163, covered: 0 }, { name: 'none', share: 0, covered: null },
  ], 'blue, painted after red, covers half of it; nothing covers blue or green; a part that paints nothing has no cover');
  assert.deepEqual(partCover(ctx, draw(1), parts.slice(0, 2)).map((p) => p.covered), [0, 0.5], 'the swapped frame');
  assert.deepEqual(partCover(ctx, draw(0), [{ name: 'both', styles: ['#f00', '#00f'] }]), [{ name: 'both', share: 0.0977, covered: 0 }], 'a part\'s own marks never cover it');
  const red = (g) => { g.fillStyle = '#f00'; g.fillRect(100, 100, 10, 10); };
  const one = (paint) => partCover(ctx, paint, [{ name: 'red', styles: ['#f00'] }])[0].covered;
  assert.equal(one((g) => { g.fillStyle = '#808080'; g.fillRect(0, 0, 960, 640); red(g); }), 0, 'a mark painted before the part lies under it');
  assert.equal(one((g) => { g.fillStyle = '#808080'; g.fillRect(0, 0, 960, 640); g.globalCompositeOperation = 'multiply'; red(g); }), 0, 'the part counts as opaque whatever it composites with');
  const translucent = one((g) => { red(g); g.fillStyle = 'rgba(0, 0, 255, 0.25)'; g.fillRect(0, 0, 960, 640); });
  assert.ok(Math.abs(translucent - 0.25) < 0.01, `a quarter-opaque mark over the part covers a quarter of it, got ${translucent}`);
  for (const colour of ['oklch(0.6 0.2 30 / 0.25)', 'lab(50 40 20 / 25%)', 'color(display-p3 0 0 1 / 0.25)', 'rgba(0, 0, 255, 0.25)']) {
    const c = one((g) => { red(g); g.fillStyle = colour; g.fillRect(0, 0, 960, 640); });
    assert.ok(Math.abs(c - 0.25) < 0.01, `a quarter-opaque ${colour} over the part covers a quarter of it, got ${c}`);
  }
  assert.equal(one((g) => { red(g); g.fillStyle = 'oklch(0.6 0.2 30 / none)'; g.fillRect(0, 0, 960, 640); }), 0, 'an alpha of none paints nothing');
  const image = (size) => one((g) => { red(g); g.drawImage(size, 0, 0); });
  assert.equal(image({ displayWidth: 960, displayHeight: 640, codedWidth: 1, codedHeight: 1 }), 1, 'a VideoFrame draws at its display size');
  assert.equal(image({ naturalWidth: 960, naturalHeight: 640, width: 1, height: 1 }), 1, 'an image draws at its natural size');
  assert.equal(image({ videoWidth: 960, videoHeight: 640, width: 0, height: 0 }), 1, 'a video draws at its own size');
  // Measured in Edge 155: an SVG <image> with no width attribute (width 0) draws at its file's size, and a file with none at the canvas's.
  assert.equal(image({ width: { baseVal: { value: 0 } }, height: { baseVal: { value: 0 } } }), 1, 'an SVG image with no width attribute counts as the canvas, not as 0');
  // Measured in Edge 155: an <img> holding an SVG with no size reads 300 x 150 natural pixels but draws at the canvas's size.
  const beyond = (img) => one((g) => { g.fillStyle = '#f00'; g.fillRect(500, 300, 10, 10); g.drawImage(img, 0, 0); });
  assert.equal(beyond({ currentSrc: 'a.svg', naturalWidth: 300, naturalHeight: 150, width: 300, height: 150 }), 1, 'an SVG <img> with no size of its own counts as the canvas, not as 300 x 150');
  assert.equal(beyond({ currentSrc: 'a.png', naturalWidth: 300, naturalHeight: 150 }), 0, 'a 300 x 150 raster image counts at its natural size');
  // Measured in Edge 155: an <img> holding an SVG with only a viewBox of 1:1 reads 150 x 150 natural pixels but draws 640 x 640 on a 960 x 640 canvas.
  assert.equal(beyond({ currentSrc: 'a.svg', naturalWidth: 150, naturalHeight: 150 }), 1, 'an SVG <img> with only a viewBox counts fitted inside the canvas, not as 150 x 150');
  const edge = (img) => one((g) => { g.fillStyle = '#f00'; g.fillRect(645, 300, 10, 10); g.drawImage(img, 0, 0); });
  assert.equal(edge({ currentSrc: 'data:image/svg+xml,<svg viewBox="0 0 100 100"/>', naturalWidth: 150, naturalHeight: 150 }), 0, 'and no wider than its fitted 640 x 640');
  // Measured in Edge 155: a data: SVG draws at the size its root <svg> gives, whatever natural size it reads.
  const at = (x, y, img) => one((g) => { g.fillStyle = '#f00'; g.fillRect(x, y, 10, 10); g.drawImage(img, 0, 0); });
  const svg = (attrs) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" ' + attrs + '><rect width="10" height="10"/></svg>');
  assert.equal(at(500, 300, { currentSrc: svg('width="300" height="150"'), naturalWidth: 300, naturalHeight: 150 }), 0, 'a data: SVG really 300 x 150 counts at 300 x 150, not as the canvas');
  assert.equal(at(500, 300, { currentSrc: 'data:image/svg+xml;base64,' + btoa('<svg width="300" height="150"/>'), naturalWidth: 300, naturalHeight: 150 }), 0, 'and read from base64');
  assert.equal(at(500, 300, { currentSrc: svg('width="200" height="150"'), naturalWidth: 200, naturalHeight: 150 }), 0, 'a data: SVG really 150 tall counts at its size, not fitted inside the canvas');
  assert.equal(at(500, 300, { currentSrc: svg('width="200"'), naturalWidth: 200, naturalHeight: 150 }), 0, 'a data: SVG with only a width counts as 200 x 640, the canvas height, not fitted inside the canvas');
  assert.equal(at(500, 500, { currentSrc: svg('viewBox="0 0 200 100"'), naturalWidth: 300, naturalHeight: 150 }), 0, 'a data: SVG with a 2:1 viewBox counts fitted as 960 x 480, not as the canvas');
  assert.equal(at(500, 100, { currentSrc: svg('viewBox="0 0 400 100"'), naturalWidth: 300, naturalHeight: 75 }), 1, 'a data: SVG with a 4:1 viewBox counts fitted as 960 x 240, not as 300 x 75');
  assert.equal(at(500, 50, { currentSrc: svg('height="100"'), naturalWidth: 300, naturalHeight: 100 }), 1, 'a data: SVG with only a height counts as 960 x 100, the canvas width, not as 300 x 100');
  assert.equal(at(500, 100, { currentSrc: 'data:image/svg+xml,<svg width="100%" viewBox="0 0 400 100"/>', naturalWidth: 300, naturalHeight: 75 }), 1, 'a data: SVG with a bare % in it reads leniently, as Edge does, and counts fitted as 960 x 240');
  assert.equal(at(0, 0, { currentSrc: svg('width="200" height="100" viewBox="0 0 0 100"'), naturalWidth: 200, naturalHeight: 100 }), 0, 'a data: SVG whose viewBox has a zero width draws nothing and covers nothing');
  // Measured in Edge 155: these root forms draw the whole canvas or their set size.
  assert.equal(at(500, 300, { currentSrc: svg('viewbox="0 0 400 100"'), naturalWidth: 300, naturalHeight: 75 }), 1, 'a lowercase viewbox is no viewBox and draws the whole canvas');
  assert.equal(at(500, 300, { currentSrc: svg('viewBox="a b 400 100"'), naturalWidth: 300, naturalHeight: 75 }), 1, 'a viewBox with a word in it is ignored and draws the whole canvas');
  assert.equal(at(500, 300, { currentSrc: svg('WIDTH="200" HEIGHT="100"'), naturalWidth: 300, naturalHeight: 150 }), 1, 'uppercase WIDTH and HEIGHT are no lengths and draw the whole canvas');
  assert.equal(at(500, 300, { currentSrc: 'data:image/svg+xml,' + encodeURIComponent('<SVG xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>'), naturalWidth: 300, naturalHeight: 150 }), 1, 'an uppercase SVG root tag is no svg root and draws the whole canvas');
  assert.equal(at(500, 300, { currentSrc: svg('width="300" height="150" viewBox="0 0 10 10" preserveAspectRatio="none"'), naturalWidth: 300, naturalHeight: 150 }), 0, 'both lengths with preserveAspectRatio none draw at those lengths');
  assert.equal(at(500, 300, { href: { baseVal: svg('width="200" height="100"') }, width: { baseVal: { value: 0 } }, height: { baseVal: { value: 0 } } }), 0, 'an SVG <image> holding a data: SVG of 200 x 100 counts at that size, not as the canvas');
  assert.equal(image({ width: 960, height: 640 }), 1, 'a canvas draws at its width and height');
  const seen = [];
  partCover(ctx, (g) => seen.push(g.canvas), [{ name: 'red', styles: ['#f00'] }]);
  assert.deepEqual(seen, [undefined, undefined], 'each pass draws on a surface without a canvas, so layers and sprites paint mark by mark');
  const serialized = new Function('PAINT', 'return (' + partCover.toString() + ')')(JSON.parse(JSON.stringify(PAINT)));
  assert.equal(JSON.stringify(serialized(ctx, draw(0), parts)), JSON.stringify(partCover(ctx, draw(0), parts)), 'it runs serialized beside PAINT, as the strip page runs it');
  // A piece that leaves a save and a translate unbalanced skews no later pass, part or cell.
  const unbalanced = (g) => { red(g); g.fillStyle = '#808080'; g.fillRect(100, 100, 5, 10); g.save(); g.translate(2000, 0); };
  const twice = [{ name: 'first', styles: ['#f00'] }, { name: 'again', styles: ['#f00'] }];
  for (const cell of [partCover(ctx, unbalanced, twice), partCover(ctx, unbalanced, twice)]) {
    assert.deepEqual(cell.map(({ share, covered }) => [share, covered]), [[0.0002, 0.5], [0.0002, 0.5]]);
  }
  // measureFrame counts every paint call partCover sorts by style.
  const paints = ['fill', 'fillRect', 'fillText', 'stroke', 'strokeRect', 'strokeText', 'drawImage', 'putImageData'], calls = paints.concat('beginPath', 'save', 'clip');
  const stub = { canvas: { width: 1, height: 1 }, getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) };
  for (const key of calls) stub[key] = () => {};
  assert.equal(measureFrame(stub, (g) => calls.forEach((key) => g[key]())).markCount, paints.length);
});

test('contact sheet: partCover keeps the operators that decide which pixels show and counts a blend mode as source-over', () => {
  // A 10 by 10 canvas that fills whole-pixel rectangles, premultiplied, with the Porter-Duff operators; any other operator throws.
  // copy here replaces only the rectangle, where a browser also clears the rest of the canvas.
  const px = new Float64Array(400), kept = [], KEYS = ['fillStyle', 'globalAlpha', 'globalCompositeOperation'];
  const OPS = {
    'source-over': (s, d, sa) => s + d * (1 - sa), 'destination-over': (s, d, sa, da) => s * (1 - da) + d, 'destination-out': (s, d, sa) => d * (1 - sa), 'source-atop': (s, d, sa, da) => s * da + d * (1 - sa),
    'source-in': (s, d, sa, da) => s * da, 'source-out': (s, d, sa, da) => s * (1 - da), 'destination-in': (s, d, sa) => d * sa, 'destination-atop': (s, d, sa, da) => s * (1 - da) + d * sa,
    xor: (s, d, sa, da) => s * (1 - da) + d * (1 - sa), copy: (s) => s,
  };
  const ctx = {
    canvas: { width: 10, height: 10 }, fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over', shadowColor: '', filter: 'none',
    save() { kept.push(KEYS.map((k) => this[k])); },
    restore() { const s = kept.pop(); KEYS.forEach((k, i) => { this[k] = s[i]; }); },
    reset() { px.fill(0); },
    fillRect(x, y, w, h) {
      const m = /^rgba\(0, 0, 0, ([\d.]+)\)$/.exec(this.fillStyle), a = (m ? Number(m[1]) : 1) * this.globalAlpha, c = this.fillStyle === '#ffffff' ? a : 0;
      const op = OPS[this.globalCompositeOperation];
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          const p = (j * 10 + i) * 4, da = px[p + 3];
          [c, c, c, a].forEach((s, k) => { px[p + k] = op(s, px[p + k], a, da); });
        }
      }
    },
    getImageData() {
      const data = new Uint8ClampedArray(400);
      for (let p = 0; p < 400; p += 4) {
        for (let k = 0; k < 3; k++) data[p + k] = px[p + 3] ? (px[p + k] / px[p + 3]) * 255 : 0;
        data[p + 3] = px[p + 3] * 255;
      }
      return { data };
    },
  };
  const part = (g, op = 'source-over') => { g.globalCompositeOperation = op; g.fillStyle = '#f00'; g.fillRect(0, 0, 5, 10); g.globalCompositeOperation = 'source-over'; };
  const mark = (op, style, rect = [0, 0, 10, 10]) => (g) => { g.globalCompositeOperation = op; g.fillStyle = style; g.fillRect(...rect); g.globalCompositeOperation = 'source-over'; };
  const cover = (...paints) => partCover(ctx, (g) => paints.forEach((p) => p(g)), [{ name: 'part', styles: ['#f00'] }])[0];
  assert.deepEqual(cover(part, mark('source-over', '#808080', [0, 0, 5, 5])), { name: 'part', share: 0.5, covered: 0.5 }, 'a later source-over mark covers what it hits');
  assert.equal(cover(part, mark('destination-over', '#808080')).covered, 0, 'a later destination-over mark goes under the part');
  assert.equal(cover(part, mark('destination-out', '#808080', [0, 0, 5, 5])).covered, 0.5, 'a later destination-out mark erases the part\'s pixels it hits');
  near(cover(part, mark('destination-out', 'rgba(9, 9, 9, 0.5)')).covered, 0.5, 'a half-opaque destination-out mark erases half of each pixel', 0.01);
  assert.deepEqual(cover(mark('source-over', '#808080', [0, 0, 5, 5]), (g) => part(g, 'destination-over')), { name: 'part', share: 0.5, covered: 0.5 },
    'a part drawn destination-over goes under the marks painted before it, and its share is its own shape');
  assert.equal(cover((g) => part(g, 'source-atop')).covered, 1, 'a part drawn source-atop over empty canvas does not show, with no later mark');
  assert.equal(cover(mark('source-over', '#808080', [0, 0, 5, 5]), (g) => part(g, 'source-atop')).covered, 0.5, 'a source-atop part shows only over the earlier mark');
  const earlier = mark('source-over', '#808080', [0, 0, 5, 5]);
  assert.equal(cover(earlier, (g) => part(g, 'destination-atop')).covered, 0.5, 'a destination-atop part is hidden where an earlier mark lies');
  assert.equal(cover(earlier, (g) => part(g, 'source-out')).covered, 0.5, 'a source-out part is hidden where an earlier mark lies');
  assert.equal(cover(earlier, (g) => part(g, 'xor')).covered, 0.5, 'an xor part is hidden where an earlier mark lies');
  assert.equal(cover(earlier, (g) => part(g, 'source-in')).covered, 0.5, 'a source-in part shows only over the earlier mark');
  assert.equal(cover(earlier, (g) => part(g, 'destination-in')).covered, 1, 'a destination-in part never shows');
  assert.equal(cover(earlier, (g) => part(g, 'destination-out')).covered, 1, 'a destination-out part never shows');
  assert.equal(cover(mark('source-over', '#808080'), (g) => part(g, 'copy')).covered, 0, 'a copy part shows whole over an earlier mark');
  assert.equal(cover((g) => part(g, 'copy'), earlier).covered, 0.5, 'a copy part is covered only by later marks');
  near(cover(mark('source-over', 'rgba(9, 9, 9, 0.25)'), (g) => part(g, 'destination-over')).covered, 0.25, 'under a quarter-opaque earlier mark, a quarter is covered', 0.01);
  near(cover(part, mark('multiply', 'rgba(255, 255, 255, 0.5)')).covered, 0.5, 'a later blend-mode mark covers as source-over at its alpha', 0.01);
  assert.equal(cover((g) => part(g, 'multiply'), mark('screen', '#000000', [0, 0, 5, 5])).covered, 0.5, 'a blend-mode part and a later blend-mode mark both count as source-over');
});

test('contact sheet: --part names a part by its colours on a time strip with --json, and is refused anywhere else', async (t) => {
  assert.deepEqual(parseArgs(['readout', '--at', '2', '--part', 'red=#f00', '--part', 'lead=#ff0000+rgba(255, 0, 0, 0.5)', '--json']).strip.parts,
    [{ name: 'red', styles: ['#f00'] }, { name: 'lead', styles: ['#ff0000', 'rgba(255, 0, 0, 0.5)'] }]);
  assert.ok(!('parts' in parseArgs(['readout', '--at', '2']).strip), 'a strip without --part keeps its shape');
  const refusals = [
    [['readout', '--at', '2', '--json', '--part'], /--part needs a name and the colour its marks are painted with, such as red=#f00, several colours joined by \+, got nothing/],
    [['readout', '--at', '2', '--json', '--part', 'red'], /--part needs a name and the colour .* got red$/m],
    [['readout', '--at', '2', '--json', '--part', '=#f00'], /--part needs a name and the colour .* got =#f00$/m],
    [['readout', '--at', '2', '--json', '--part', 'red=#f00+'], /--part needs a name and the colour .* got red=#f00\+$/m],
    [['readout', '--at', '2', '--json', '--part', 'red=#f00', '--part', 'red=#00f'], /use --part red only once/],
    [['drift', '--part', 'red=#f00', '--json'], /--part reads the frames of a time strip; add --frames, --at, --shots or --contacts/],
    [['readout', '--at', '2', '--part', 'red=#f00'], /--part reports in the sheet's JSON; add --json/],
  ];
  for (const [bad, message] of refusals) {
    await t.test(bad.join(' '), () => assert.throws(() => parseArgs(bad), (e) => message.test(e.message) && e.message.startsWith('seeds: ') && e.message.endsWith(USAGE)));
  }
});

test('contact sheet: a --part strip page measures each part on every drawn cell, and a plain strip page carries no measure', () => {
  assert.doesNotMatch(page(['readout'], 3, 1, [], null, null, { frames: 3 }), /function partCover\(/);
  const parts = [{ name: 'red', styles: ['#f00'] }];
  assert.deepEqual(planStrip(touching(), { at: [0], parts }).parts, parts);
  const html = page(['touching'], 2, 1, [], touchingExternal(), null, { at: [0, 0.125], parts });
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
  // The stand-in canvases read back transparent pixels, so the part paints nothing there.
  const { window } = runStrip({ at: [0, 0.125], parts }, {}, 'touching', [], 2, touchingExternal());
  const cells = JSON.parse(JSON.stringify(window.__sheet.cells));
  assert.equal(cells.length, 2);
  for (const cell of cells) {
    assert.equal(cell.error, null);
    assert.ok(!('partsError' in cell), cell.partsError);
    assert.deepEqual(cell.parts, [{ name: 'red', share: 0, covered: null }]);
  }
  assert.ok(runStrip({ frames: 3 }).window.__sheet.cells.every((cell) => !('parts' in cell)), 'a strip without --part adds no key');
});

test('contact sheet: --figure names a figure by its colours on any time strip and is refused anywhere else', async (t) => {
  assert.deepEqual(parseArgs(['readout', '--at', '2', '--figure', 'body=#f00+#00f']).strip.figures, [{ name: 'body', styles: ['#f00', '#00f'] }], 'it needs no --json');
  assert.deepEqual(parseArgs(['readout', '--at', '2', '--figure', 'a=#f00', '--figure', 'b=#0f0', '--png']).strip.figures.map((f) => f.name), ['a', 'b']);
  assert.ok(!('figures' in parseArgs(['readout', '--at', '2']).strip), 'a strip without --figure keeps its shape');
  const refusals = [
    [['readout', '--at', '2', '--figure'], /--figure needs a name and the colours its painted fill and contour strokes use, such as body=#b07a5a\+#2a2320, several colours joined by \+, got nothing/],
    [['readout', '--at', '2', '--figure', 'body'], /--figure needs a name and the colours .* got body$/m],
    [['readout', '--at', '2', '--figure', '=#f00'], /--figure needs a name and the colours .* got =#f00$/m],
    [['readout', '--at', '2', '--figure', 'body=#f00+'], /--figure needs a name and the colours .* got body=#f00\+$/m],
    [['readout', '--at', '2', '--figure', 'body=#f00', '--figure', 'body=#00f'], /use --figure body only once/],
    [['drift', '--figure', 'body=#f00'], /--figure reads the frames of a time strip; add --frames, --at, --shots or --contacts/],
  ];
  for (const [bad, message] of refusals) {
    await t.test(bad.join(' '), () => assert.throws(() => parseArgs(bad), (e) => message.test(e.message) && e.message.startsWith('seeds: ') && e.message.endsWith(USAGE)));
  }
});

test('contact sheet: silhouette reads gaps, holes, pinholes, widths and the plumb line of a flat fill', () => {
  // RGBA with alpha 255 inside each [x, y, w, h] rectangle.
  const mask = (w, h, rects) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const [rx, ry, rw, rh] of rects) for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) data[4 * (y * w + x) + 3] = 255;
    return data;
  };
  // A trunk and an arm hung from its shoulder by a bridge, 3 pixels apart, open below the hand; 2 cell and 3 film pixels per unit.
  const trunk = [10, 5, 10, 30], arm = [23, 5, 3, 20], shoulder = [20, 5, 3, 3];
  const open = silhouette(mask(40, 40, [trunk, arm, shoulder]), 40, 40, 2, 3);
  assert.deepEqual(open.gaps, [{ x: 10, y: 4, w: 1.5, h: 8.5, area: 12.75, widest: 4.5, closed: false }], 'one open lens, its widest run in film pixels');
  assert.deepEqual([open.area, open.box, open.pinholes], [(300 + 60 + 9) / 4, [5, 2.5, 13, 17.5], 0]);
  // The first tenth's row crosses the trunk and the arm: its width spans both, its widest run is the trunk's alone.
  assert.deepEqual([open.widths[0], open.runs[0], open.widths[8], open.runs[8]], [8, 5, 5, 5], 'a part beside the rest widens the span, never the widest run');
  const shut = silhouette(mask(40, 40, [trunk, arm, shoulder, [20, 22, 3, 3]]), 40, 40, 1, 2);
  assert.deepEqual(shut.gaps.map((g) => [g.x, g.y, g.w, g.h, g.widest, g.closed]), [[20, 8, 3, 14, 6, true]], 'an arm joined at both ends closes a hole');
  // A one-pixel hole is a pinhole, not a gap; a smaller open notch is neither.
  const holed = mask(30, 30, [[5, 5, 20, 20]]);
  holed[4 * (15 * 30 + 15) + 3] = 0;
  assert.deepEqual([silhouette(holed, 30, 30, 1, 1).gaps, silhouette(holed, 30, 30, 1, 1).pinholes], [[], 1]);
  assert.equal(silhouette(mask(10, 10, []), 10, 10, 1, 1), null, 'nothing inside');
  // A wide block over a narrow one: the widths at tenths of the box, and the plumb line over the narrow support.
  const tee = silhouette(mask(30, 10, [[0, 0, 30, 5], [10, 5, 10, 5]]), 30, 10, 1, 1);
  assert.deepEqual(tee.widths, [30, 30, 30, 30, 10, 10, 10, 10, 10]);
  assert.deepEqual(tee.runs, tee.widths, 'an unbroken row runs its whole span');
  assert.deepEqual(tee.plumb, { x: 15, from: 10, to: 20, over: true });
  // A mass that hangs past its foot.
  const leaning = silhouette(mask(40, 10, [[20, 0, 20, 8], [0, 8, 4, 2]]), 40, 10, 1, 1);
  assert.deepEqual([leaning.plumb.from, leaning.plumb.to, leaning.plumb.over], [0, 4, false]);
  assert.deepEqual(new Function('return (' + silhouette.toString() + ')')()(mask(40, 40, [trunk, arm, shoulder]), 40, 40, 2, 3), open, 'it runs serialized, as the strip page runs it');
});

test('contact sheet: figureFill paints only the figure\'s colours, opaque, on a surface without a canvas', () => {
  const ctx = fakeCanvas({ width: 960, height: 640 }, nullSurface).getContext('2d');
  const t = touching(), solved = solve(t, t.seed);
  const draw = (g) => drawFrame(g, t, solved, playheads(t)[0]);
  const inside = (data) => { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) n++; return n; };
  const red = figureFill(ctx, draw, ['#f00']);
  assert.equal(inside(red.data), 200 * 200, 'the whole red square, though blue is painted over half of it');
  assert.equal(partCover(ctx, draw, [{ name: 'red', styles: ['#f00'] }])[0].share, +(inside(red.data) / (960 * 640)).toFixed(4));
  assert.equal(red.data[4 * (150 * 960 + 350) + 3], 0, 'the blue square is left out');
  assert.equal(red.data[4 * (150 * 960 + 250) + 3], 255, 'opaque where the figure is');
  assert.deepEqual(silhouette(red.data, 960, 640, 1, 2), { area: 40000, box: [100, 100, 300, 300], gaps: [], pinholes: 0, widths: Array(9).fill(200), runs: Array(9).fill(200), plumb: { x: 200, from: 100, to: 300, over: true } });
  assert.equal(inside(figureFill(ctx, draw, ['#f00', '#00f']).data), 200 * 300, 'two colours make one figure');
  const seen = [];
  figureFill(ctx, (g) => seen.push(g.canvas), ['#f00']);
  assert.deepEqual(seen, [undefined]);
  const serialized = new Function('PAINT', 'return (' + figureFill.toString() + ')')(JSON.parse(JSON.stringify(PAINT)));
  const again = serialized(ctx, draw, ['#f00']).data, direct = figureFill(ctx, draw, ['#f00']).data;
  assert.equal(again.length, direct.length);
  assert.equal(again.findIndex((v, i) => v !== direct[i]), -1, 'it runs serialized beside PAINT, as the strip page runs it');
});

test('contact sheet: a --figure strip page measures each figure on every drawn cell and draws a flat-fill view; a plain strip page carries neither', () => {
  assert.doesNotMatch(page(['readout'], 3, 1, [], null, null, { frames: 3 }), /function silhouette\(/);
  const figures = [{ name: 'red', styles: ['#f00'] }];
  const layout = planStrip(touching(), { at: [0], figures });
  assert.deepEqual(layout.figures, figures);
  assert.equal(layout.film, 2, 'film pixels per design unit, for widest');
  assert.ok(!('figures' in planStrip(touching(), { at: [0] })));
  const html = page(['touching'], 2, 1, [], touchingExternal(), null, { at: [0, 0.125], figures });
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
  // The stand-in canvases read back transparent pixels, so the figure paints nothing there.
  const { window, elements } = runStrip({ at: [0, 0.125], figures }, {}, 'touching', [], 2, touchingExternal());
  const cells = JSON.parse(JSON.stringify(window.__sheet.cells));
  assert.equal(cells.length, 2);
  for (const cell of cells) {
    assert.equal(cell.error, null);
    assert.ok(!('figuresError' in cell), cell.figuresError);
    assert.deepEqual(cell.figures, [{ name: 'red', area: 0, box: null, gaps: [], pinholes: 0, widths: null, runs: null, plumb: null, widthStep: null }]);
  }
  const captions = elements.filter((el) => el.tag === 'figcaption' && /^flat fill /.test(el.textContent || ''));
  assert.deepEqual(captions.map((el) => el.textContent), ['flat fill red: nothing painted', 'flat fill red: nothing painted'], 'one flat-fill caption per cell');
  // Real pixels: each read of a canvas fills a 50-pixel-tall rectangle 10 pixels wider than its last read, so the figure
  // canvas, read once per cell, widens by 10 pixels a cell: widthStep 10 / 50 against the previous cell, null where a shot opens.
  const reads = new Map();
  const widening = (w, h, canvas) => {
    const d = new Uint8ClampedArray(w * h * 4), n = reads.get(canvas) || 0;
    reads.set(canvas, n + 1);
    for (let y = 0; y < Math.min(h, 50); y++) for (let x = 0; x < Math.min(w, 10 * (n + 1)); x++) d[4 * (y * w + x) + 3] = 255;
    return d;
  };
  const shot = JSON.parse(JSON.stringify(runStrip({ at: [5.5, 5.9, 6, 6.5], figures }, {}, 'readout', [], 3, null, null, null, null, widening).window.__sheet.cells));
  assert.ok(shot.every((cell) => !('figuresError' in cell)), shot.map((cell) => cell.figuresError).join());
  assert.deepEqual(shot.map((cell) => cell.figures[0].widthStep), [null, 0.2, null, 0.2], 'the previous cell compared, divided by the box height, and reset where shot rest opens');
  assert.ok(runStrip({ frames: 3 }).window.__sheet.cells.every((cell) => !('figures' in cell)), 'a strip without --figure adds no key');
  assert.match(sheetStem(['touching'], [], touchingExternal(), null, { at: [0], figures }), /-at\+figure$/);
});

test('contact sheet: --armature takes no value on any time strip and is refused anywhere else', () => {
  assert.equal(parseArgs(['readout', '--at', '2', '--armature']).strip.armature, true);
  assert.ok(!('armature' in parseArgs(['readout', '--at', '2']).strip), 'a strip without --armature has no armature key');
  assert.throws(() => parseArgs(['readout', '--at', '2', '--armature', '--armature']), { message: `seeds: use --armature only once\n${USAGE}` });
  assert.throws(() => parseArgs(['readout', '--armature']), { message: `seeds: --armature reads the frames of a time strip; add --frames, --at, --shots or --contacts\n${USAGE}` });
  assert.match(sheetStem(['readout'], [], null, null, { at: [0], armature: true }), /-at\+armature$/);
  assert.ok(USAGE.includes('[--figure name=colour[+colour...]]... [--armature] '));
});

// One chain posed down the picture from `root`; `bends[i]` bends and twists segment i's joint.
const rodChain = (bends = [], { lengths = [40, 40], root = [0, 0, 0], ...more } = {}) => ({
  name: 'chain', view: {}, front: false, limits: {}, reasons: {}, planted: null, ...more,
  segments: pose(root, { forward: [0, 1, 0], side: [1, 0, 0] }, lengths.map((length, i) => ({ length, radius: [4, 3], ...bends[i] }))),
});

test('contact sheet: jointFaults names a front-view joint off its line, a joint past its limit, a segment changing length and a planted end sliding', () => {
  const kinds = (faults) => faults.map((f) => [f.frame, f.kind, f.joint ?? f.segment ?? f.end, f.value]);
  assert.deepEqual(jointFaults([[rodChain([], { front: true })]]), [], 'a straight chain');
  // A twist of a quarter turn puts the bend in the picture plane: the joint leaves the line by tan(bend / 2) / 2 of the span.
  const sideways = [{}, { twist: Math.PI / 2, bend: 0.5 }];
  assert.deepEqual(kinds(jointFaults([[rodChain(sideways, { front: true })]])), [[0, 'line', 1, +(Math.tan(0.25) / 2).toFixed(3)]]);
  assert.deepEqual(jointFaults([[rodChain(sideways, { front: true, reasons: { 1: 'reason' } })]]), [], 'a pose reason exempts the joint');
  assert.deepEqual(jointFaults([[rodChain(sideways)]]), [], 'no front view, no line rule');
  assert.deepEqual(jointFaults([[rodChain([{}, { bend: 0.5 }], { front: true })]]), [], 'a bend in depth stays on the line in a front view');
  assert.deepEqual(kinds(jointFaults([[rodChain([{}, { bend: 0.8 }], { limits: { 1: 0.5 } })]])), [[0, 'limit', 1, 0.8]]);
  assert.deepEqual(jointFaults([[rodChain([{}, { bend: 0.4 }], { limits: { 1: 0.5 } })]]), [], 'within its limit');
  const stretched = [[rodChain()], [rodChain([], { lengths: [44, 40] })]];
  assert.deepEqual(kinds(jointFaults(stretched)), [[1, 'length', 0, 0.1]]);
  const slid = [[rodChain([], { planted: 'end' })], [rodChain([], { planted: 'end', root: [3, 0, 0] })]];
  assert.deepEqual(kinds(jointFaults(slid)), [[1, 'slide', 'end', 3]]);
  assert.deepEqual(jointFaults(slid.map((f) => f.map((c) => ({ ...c, planted: 'start' })))).map((f) => f.value), [3], 'a planted start');
  assert.deepEqual(jointFaults([[rodChain([], { planted: 'start' })], slid[1]]), [], 'planted at another end the frame before');
  assert.deepEqual(jointFaults(stretched, [1]), [], 'a shot that opens on the frame is not compared with the frame before');
  assert.deepEqual(jointFaults(slid, [1]), []);
  assert.deepEqual(jointFaults([[], stretched[1]]), [], 'a chain missing the frame before');
  assert.deepEqual(jointFaults([[rodChain([], { lengths: [44, 40, 40] })], stretched[1]]), [], 'another segment count the frame before');
  assert.deepEqual(jointFaults([[{ ...rodChain(), name: 'other' }], stretched[1]]), [], 'another name the frame before');
});

test('contact sheet: armatureList refuses an armature it cannot read, by name', () => {
  const rod = (more = {}) => ({ ...rodChain(), name: 'rod', ...more });
  const refusal = (armature, cause) => {
    const p = validate({ name: 'rig', size: { w: 100, h: 50 }, seed: 1, time: { duration: 0.2, hz: 10 },
      build: [['rig', (s) => { s.cues = armature === undefined ? {} : { armature }; }]], draw() {} });
    assert.throws(() => planStrip(p, { frames: 2, armature: true }), { message: `seeds: ${cause}\n${USAGE}` }, cause);
  };
  refusal(undefined, '--armature reads one armature per frame from state.cues.armature, and rig keeps none there');
  refusal([[rod()]], '--armature reads one armature per frame from state.cues.armature, and rig keeps 1 for its 2 frames');
  refusal([{}, null], '--armature: state.cues.armature entry [0] is not a list of chains');
  refusal([null, [{ ...rod(), name: '' }]], '--armature: state.cues.armature entry [1] chain [0] needs a name of its own');
  refusal([[rod(), rod()], null], '--armature: state.cues.armature entry [0] chain [1] needs a name of its own');
  const [a, b] = rod().segments;
  refusal([[rod({ segments: [a, { ...b, start: [2, 40, 0] }] })], null],
    '--armature: state.cues.armature entry [0] chain rod: segment 1 starts 2 from where segment 0 ends; a chain\'s segments join end to start, as pose returns them');
  refusal([[rod({ segments: [{ ...a, end: a.start }] })], null], '--armature: state.cues.armature entry [0] chain rod: project: segment 0 has zero length; give it an end apart from its start');
  refusal([[rod({ limits: { 2: 1 } })], null], '--armature: state.cues.armature entry [0] chain rod: limits names joint 2, and a chain of 2 segments bends at joint 1');
  refusal([[rod({ limits: { 1: 4 } })], null], '--armature: state.cues.armature entry [0] chain rod: limits [1] takes the largest bend in radians, above 0 and at most pi, got 4');
  refusal([[rod({ reasons: { 1: ' ' } })], null], '--armature: state.cues.armature entry [0] chain rod: reasons [1] takes a pose reason, a non-empty string, got " "');
  refusal([[rod({ planted: 'middle' })], null], '--armature: state.cues.armature entry [0] chain rod: takes planted: \'start\', \'end\' or no planted, got planted: "middle"');
  refusal([[rod({ front: 1 })], null], '--armature: state.cues.armature entry [0] chain rod: takes front: true, false or no front, got front: 1');
  const p = validate({ name: 'rig', size: { w: 100, h: 50 }, seed: 1, time: { duration: 0.2, hz: 10 }, build: [['rig', (s) => { s.cues = { armature: [null, [rod()]] }; }]], draw() {} });
  const list = armatureList(p, solve(p, 1).state);
  assert.deepEqual(list.map((chains) => chains.map((c) => [c.name, c.front, c.planted])), [[], [['rod', false, null]]], 'null is a frame with nothing posed');
});

test('contact sheet: an --armature strip carries each cell\'s projected armature and faults, draws the overlay under the cell, and prints the faults per frame', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-armature-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rig-strip.cjs');
  // Three frames of one chain; frame 1 bends sideways in the picture.
  fs.writeFileSync(file, "const { pose, project } = require('artifex/core/armature.js');\n"
    + "const rod = (f) => ({ name: 'rod', front: true, segments: pose([50, 5, 0], { forward: [0, 1, 0], side: [1, 0, 0] }, [{ length: 20, radius: [3, 2] }, { length: 20, radius: [2, 1], twist: f === 1 ? Math.PI / 2 : 0, bend: f === 1 ? 0.6 : 0 }]) });\n"
    + "module.exports = { name: 'rig-strip', size: { w: 100, h: 50 }, seed: 1, time: { duration: 0.3, hz: 10 },"
    + " build: [['rig', (s) => { s.cues = { armature: [0, 1, 2].map((f) => [rod(f)]) }; }]],"
    + ' draw(g, s, t, clock) { for (const ch of s.cues.armature[clock.frame]) for (const sg of project(ch.segments).segments) { g.lineWidth = 4; g.beginPath(); g.moveTo(sg.a[0], sg.a[1]); g.lineTo(sg.b[0], sg.b[1]); g.stroke(); } } };\n');
  const external = loadExternal(file);
  const at = [0, 0.1, 0.2];
  const layout = planStrip(validate(external.piece), { at, armature: true });
  assert.deepEqual(layout.armature.rules, ARMATURE_RULES);
  assert.deepEqual(layout.armature.faults.map((f) => [f.frame, f.chain, f.kind, f.joint]), [[1, 'rod', 'line', 1]]);
  assert.deepEqual(layout.cells.map((c) => c.armature.faults.length), [0, 1, 0]);
  const [first] = layout.cells[0].armature.chains[0].segments;
  assert.deepEqual([first.a, first.b, first.sections.length], [[50, 5], [50, 25], 2], 'projected in design units');
  assert.deepEqual(first.sections[0], { centre: [50, 5], major: 3, minor: 0, angle: 0 });
  const { window, elements } = runStrip({ at, armature: true }, {}, 'rig-strip', [], 3, external);
  const sheet = JSON.parse(JSON.stringify(window.__sheet));
  assert.deepEqual(sheet.cells.map((c) => [c.error, c.armature.length]), [[null, 0], [null, 1], [null, 0]]);
  assert.equal(sheet.strip.armature.faults.length, 1);
  const captions = elements.filter((el) => el.tag === 'figcaption' && /^armature: /.test(el.textContent || ''));
  assert.deepEqual(captions.map((el) => [el.textContent, el.className]), [
    ['armature: 1 chain · no joint faults', undefined],
    ['armature: 1 chain · 1 joint fault: rod joint 1 off its line', 'flag'],
    ['armature: 1 chain · no joint faults', undefined],
  ]);
  assert.ok(JSON.parse(JSON.stringify(runStrip({ at }, {}, 'rig-strip', [], 3, external).window.__sheet.cells)).every((c) => !('armature' in c)), 'a strip without --armature adds no key');
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), file, '--at', at.join(','), '--armature'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\narmature: 1 of 3 frames with joint faults \(rules: line 0\.05 of the span in a front view, length 0\.01, slide 0\.5 design units\)\nframe 1 \(0\.100 s\): rod joint 1 leaves the line between its neighbours by 0\.\d+ of their span in a front view, with no pose reason\n/);
  // The printed lines stop at 24 frames.
  const many = armatureText(Array.from({ length: 30 }, (_, frame) => ({ frame, chain: 'rod', kind: 'limit', joint: 1, value: 1, rule: 0.5 })), 30, 10);
  assert.equal(many.length, 26);
  assert.equal(many[1], 'frame 0 (0.000 s): rod joint 1 bends 1 rad, past its limit of 0.5');
  assert.equal(many[25], '... and 6 more frames with joint faults; --json lists every one in strip.armature.faults');
  assert.deepEqual(armatureText([], 3, 10), ['armature: no joint faults on 3 frames']);
  assert.equal(armatureText([{ frame: 0, chain: 'rod', kind: 'slide', end: 'start', value: 2, rule: 0.5 }], 1, null)[1], 'the still: rod planted start slides 2 design units since the frame before');
});

test('contact sheet: a --figure or --part colour the canvas rejects is refused, and a figure that cannot be filled says why under its cell', () => {
  // A canvas that, as a browser's, keeps the style set before a colour it rejects.
  const takes = (s) => s !== 'nocolour';
  let style = '#000000';
  const ctx = { canvas: { width: 2, height: 2 }, save() {}, restore() {}, reset() {}, getImageData: () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16) }) };
  Object.defineProperty(ctx, 'fillStyle', { get: () => style, set: (s) => { if (takes(s)) style = s; } });
  const FIGURE = 'seeds: --figure takes colours the canvas reads, such as #b07a5a or rgba(176, 122, 90, 0.5), got nocolour';
  const PART = 'seeds: --part takes colours the canvas reads, such as #f00 or rgba(255, 0, 0, 0.5), got nocolour';
  assert.throws(() => figureFill(ctx, () => {}, ['#f00', 'nocolour']), (e) => e.refusal === true && e.message === FIGURE);
  assert.throws(() => partCover(ctx, () => {}, [{ name: 'red', styles: ['nocolour'] }]), (e) => e.refusal === true && e.message === PART);
  // On the strip page: each cell keeps the error, the figure's says it under the cell, and the sheet carries the refusal.
  const strip = (option) => {
    const { window, elements } = runStrip({ at: [0, 0.125], ...option }, {}, 'touching', [], 2, touchingExternal(), null, null, null, null, null, null, takes);
    return { sheet: JSON.parse(JSON.stringify(window.__sheet)), elements };
  };
  const drawn = strip({ figures: [{ name: 'red', styles: ['nocolour'] }] });
  assert.deepEqual(drawn.sheet.cells.map((cell) => [cell.figuresError, 'figures' in cell]), [[FIGURE, false], [FIGURE, false]]);
  assert.deepEqual(drawn.elements.filter((el) => el.tag === 'figcaption' && /^flat fill /.test(el.textContent || '')).map((el) => el.textContent),
    ['flat fill failed: ' + FIGURE, 'flat fill failed: ' + FIGURE], 'shown under each cell, so the page and its PNG say it');
  assert.throws(() => refuseSheet(drawn.sheet), (e) => e.message === FIGURE + '\n' + USAGE);
  const parted = strip({ parts: [{ name: 'red', styles: ['nocolour'] }] });
  assert.deepEqual(parted.sheet.cells.map((cell) => cell.partsError), [PART, PART]);
  assert.throws(() => refuseSheet(parted.sheet), (e) => e.message === PART + '\n' + USAGE);
});

test('contact sheet: stride keeps every plant on one side of the walker on every frame shown, and cascade its discs over its ledges', () => {
  const WOOD = ['#c98549', '#8a5a38'];
  const p = validate(EXAMPLES.stride), frames = [0, 14, 60, 150];
  const plant = (m) => m.op === 'stroke' && /^#[0-9a-f]{6}$/.test(m.style) && (Math.abs(m.width - 1.3) < 1e-9 || Math.abs(m.width - 1.6) < 1e-9);
  const root = (m) => Math.max(...m.starts.map((s) => s[1]));
  for (const seed of [1, 2, 3, 4]) {
    const solved = solve(p, seed);
    // The sole's underside is 4 under the ground line: a plant rooted above it
    // is painted behind the walker, one rooted at or below it in front.
    const ground = Math.max(...solved.state.poses[0].feet.map((ft) => ft.heel[1]));
    const figure = (m) => m.op === 'stroke' && WOOD.includes(m.style);
    const marks = recordMarks(p.size, (g) => drawFrame(g, p, solved, playheads(p)[14]));
    assert.ok(marks.filter(plant).length > 20 && marks.filter(figure).length > 10, `seed ${seed}: ${marks.length} marks`);
    assert.deepEqual(layerSwaps(p, solved, frames, { figure, near: (m) => plant(m) && root(m) >= ground + 4, far: (m) => plant(m) && root(m) < ground + 4 }), [], `seed ${seed}`);
    const asOne = layerSwaps(p, solved, frames, { figure, plants: plant });
    assert.ok(asOne.length > 0 && asOne.every((o) => o.pair === 'figure/plants'), `seed ${seed}: plants taken as one thing lie on both sides of the walker: ${JSON.stringify(asOne)}`);
  }
  const c = validate(EXAMPLES.cascade), solved = solve(c, c.seed);
  const colours = new Set(solved.state.bodies.discs.map((d) => d.colour));
  const things = { discs: (m) => m.op === 'fill' && colours.has(m.style), edges: (m) => m.op === 'stroke' && m.width === 1.5 };
  const order = paintOrder(recordMarks(c.size, (g) => drawFrame(g, c, solved, playheads(c)[100])), things)['discs/edges'];
  assert.ok(order.front > 0 && order.behind === 0, `the discs lie on the ledges on frame 100: ${JSON.stringify(order)}`);
  assert.deepEqual(layerSwaps(c, solved, [0, 40, 100, 160, 215], things), []);
});

test('contact sheet: --values, --grey and --colour-vision add views to any sheet or strip, and leave the arguments unchanged without them', () => {
  assert.deepEqual(parseArgs(['drift', '--values']).views, { values: true, grey: false, colourVision: false, gamut: false });
  const strip = parseArgs(['readout', '--frames', '3', '--grey', '--colour-vision']);
  assert.deepEqual([strip.strip.frames, strip.views], [3, { values: false, grey: true, colourVision: true, gamut: false }]);
  assert.deepEqual(parseArgs(['drift', '3', '--param', 'reach', '--values']).views, { values: true, grey: false, colourVision: false, gamut: false }, 'a sweep takes them');
  assert.deepEqual(parseArgs(['drift', '--gamut', 'FOGRA39L.txt']).views, { values: false, grey: false, colourVision: false, gamut: 'FOGRA39L.txt' }, '--gamut on a seed sheet, with the file it reads');
  assert.deepEqual(parseArgs(['readout', '--at', '0', '--gamut', 'data/FOGRA39L.txt']).views, { values: false, grey: false, colourVision: false, gamut: 'data/FOGRA39L.txt' }, 'and on a strip');
  assert.equal('views' in parseArgs(['drift']), false, 'without the flags a seed sheet\'s arguments are unchanged');
  assert.equal('views' in parseArgs(['readout', '--frames', '3']), false, 'and so are a strip\'s');
  const out = path.join(__dirname, '..', 'out');
  const all = { values: true, grey: true, colourVision: true };
  assert.equal(sheetStem(['readout'], [], null, null, { frames: 3 }, null, { values: true, grey: false, colourVision: false }), path.join(out, 'readout-frames+values'));
  assert.equal(path.basename(sheetStem(['readout'], [], null, null, { at: [2] }, null, all)), 'readout-at+values+grey+colour-vision');
  assert.equal(path.basename(sheetStem(['drift'], [], null, null, null, null, { values: true, grey: true, colourVision: false })), 'drift-seeds+values+grey');
  assert.equal(path.basename(sheetStem(['drift'], [], null, null, null, null, { values: false, grey: false, colourVision: false, gamut: true })), 'drift-seeds+gamut');
  assert.equal(path.basename(sheetStem(['readout'], [], null, null, { at: [2] }, null, { ...all, gamut: true })), 'readout-at+values+grey+colour-vision+gamut');
  assert.equal(sheetStem(Object.keys(EXAMPLES), [], null, null, null, null, { values: true }), path.join(out, 'seeds+values'));
  for (const view of ['values', 'grey']) {
    assert.notEqual(sheetStem(['drift'], ['reach', view]), sheetStem(['drift'], ['reach'], null, null, null, null, { [view]: true }), `a parameter named ${view} never takes the --${view} sheet's name`);
  }
  assert.equal(sheetStem(['readout'], [], null, null, { frames: 3 }, null, null), path.join(out, 'readout-frames'), 'without views the name is unchanged');
});

test('contact sheet: cellViews\' grey is the grey of each pixel\'s OKLCh lightness over white', () => {
  const { toSRGB } = require('../core/colour.js');
  const greyOf = (c) => Math.round(255 * toSRGB(oklch(c)[0] ** 3));
  const views = (rgba) => cellViews(rgbaImage(4, 2, () => rgba), { values: false, grey: true, colourVision: false });
  const flat = views([0xc0, 0x40, 0x40, 255]);
  assert.ok(flat.grey.data.every((v, i) => (i % 4 === 3 ? v === 255 : Math.abs(v - greyOf('#c04040')) <= 1)), 'a colour gives its own grey, opaque');
  assert.equal(views([0, 0, 0, 0]).grey.data[0], 255, 'a transparent pixel is the sheet\'s white');
  assert.ok(Math.abs(views([0, 0, 0, 128]).grey.data[0] - greyOf('#7f7f7f')) <= 1, 'half-transparent black is laid over white');
  assert.deepEqual([flat.values, flat.deuteranopia, flat.protanopia, flat.tritanopia, flat.peak, flat.radius], [null, null, null, null, null, null], 'views not asked for are null, and there is no peak without values');
  near(flat.lightness.mean, oklch('#c04040')[0], 'the cell\'s mean lightness', 1e-4);
});

test('contact sheet: cellViews\' value view blurs 2% of the width, then cuts lightness into 3 levels', () => {
  const { toSRGB } = require('../core/colour.js');
  const only = { values: true, grey: false, colourVision: false };
  const halves = cellViews(greyImage(200, 100, (x) => (x < 100 ? 0 : 255)), only);
  assert.equal(halves.radius, 4);
  const at = (v, x, y) => v.values.data[(y * v.values.width + x) * 4];
  const levels = [1 / 6, 0.5, 5 / 6].map((L) => Math.round(255 * toSRGB(L ** 3)));
  assert.deepEqual([at(halves, 100 - 13, 50), at(halves, 100 + 13, 50)], [levels[0], levels[2]], 'the dark and light levels away from the edge');
  assert.deepEqual([halves.lightness.min, halves.lightness.max], [0, 1]);
  const ramp = cellViews(greyImage(256, 8, (x) => x), only);
  assert.equal(new Set(ramp.values.data.filter((_, i) => i % 4 === 0)).size, 3, 'a full ramp gives exactly 3 values');
  const line = cellViews(greyImage(200, 100, (x) => (x === 60 ? 0 : 255)), only);
  assert.equal(line.values.data.filter((v, i) => i % 4 === 0 && v !== levels[2]).length, 0, 'a one-pixel line blurs into the light level before the cut');
  const mid = cellViews(greyImage(20, 10, () => Math.round(255 * toSRGB(0.5 ** 3))), only);
  assert.equal(at(mid, 5, 5), levels[1], 'lightness near 0.5 is the middle level');
});

test('contact sheet: cellViews\' peak is the strongest step of blurred lightness, null on a flat image', () => {
  const only = { values: true, grey: false, colourVision: false };
  const disc = (cx) => greyImage(160, 80, (x, y) => (Math.hypot(x - cx, y - 40) < 15 ? 0 : 255));
  const v = cellViews(disc(50), only);
  assert.ok(Math.abs(Math.hypot(v.peak.x - 50, v.peak.y - 40) - 15) <= v.radius + 1, `peak ${JSON.stringify(v.peak)} on the disc's edge`);
  assert.ok(v.peak.contrast > 0.1);
  assert.equal(cellViews(disc(109), only).peak.contrast, v.peak.contrast, 'the mirrored disc gives the same contrast');
  assert.equal(cellViews(greyImage(40, 20, () => 90), only).peak, null, 'a flat image has no peak');
});

test('contact sheet: cellViews\' colour-vision views use the Machado 2009 matrices, keeping greys and merging what each dichromat cannot tell apart', () => {
  const views = (pixels) => cellViews(rgbaImage(pixels.length, 1, (x) => [...pixels[x], 255]), { values: false, grey: false, colourVision: true });
  const grey = views([[128, 128, 128]]);
  for (const name of ['deuteranopia', 'protanopia', 'tritanopia']) {
    assert.ok([0, 1, 2].every((c) => Math.abs(grey[name].data[c] - 128) <= 1), `${name} keeps a grey`);
  }
  // A red and the green of the same OKLab lightness, #00a600.
  near(oklch('#00a600')[0], oklch('#ff0000')[0], 'the pair shares a lightness', 1e-3);
  const pair = views([[255, 0, 0], [0, 166, 0]]);
  const apart = (d) => Math.hypot(d[0] - d[4], d[1] - d[5], d[2] - d[6]);
  for (const name of ['deuteranopia', 'protanopia']) {
    assert.ok(apart(pair[name].data) < 0.3 * Math.hypot(255, 166), `${name} merges red and green: ${apart(pair[name].data).toFixed(1)}`);
  }
  assert.ok(apart(pair.tritanopia.data) > 0.8 * Math.hypot(255, 166), 'tritanopia keeps them apart');
  const blue = views([[0, 0, 255]]), moved = (d) => Math.hypot(d[0], d[1], d[2] - 255);
  assert.ok(moved(blue.tritanopia.data) > 100 && moved(blue.tritanopia.data) > 2 * moved(blue.deuteranopia.data), 'tritanopia moves blue most');
});

test('contact sheet: cellViews\' print-gamut view flags colours outside an approximate coated-paper gamut and paints them magenta', () => {
  const { mixOklch, rgb, toSRGB } = require('../core/colour.js');
  const only = { values: false, grey: false, colourVision: false, gamut: PRINT };
  const bytes = (hex) => [...rgb(hex).slice(0, 3).map((c) => Math.round(255 * c)), 255];
  const view = (pixels) => cellViews(rgbaImage(pixels.length, 1, (x) => pixels[x]), only);
  const greyHex = (hex) => '#' + Math.round(255 * toSRGB(oklch(hex)[0] ** 3)).toString(16).padStart(2, '0').repeat(3);
  for (const hex of ['#00ff00', '#0000ff']) {
    const v = view([bytes(hex)]);
    assert.equal(v.outside.share, 1, `${hex} is outside`);
    assert.ok(v.outside.excess > 0.1, `${hex} is far from the gamut: ${v.outside.excess}`);
    assert.deepEqual([...v.gamut.data], [255, 0, 255, 255], `${hex} is painted magenta`);
    // Drained by chroma alone, as stills.md's soft proof says, it comes inside.
    const drained = view([bytes(mixOklch(hex, greyHex(hex), 0.9))]);
    assert.deepEqual({ ...drained.outside }, { share: 0, excess: 0 }, `${hex} drained by 0.9 is inside`);
  }
  for (const pixel of [[128, 128, 128, 255], [255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 0], bytes('#9a7b64')]) {
    const v = cellViews(rgbaImage(1, 1, () => pixel), { ...only, grey: true });
    assert.deepEqual({ ...v.outside }, { share: 0, excess: 0 }, `${pixel} is inside`);
    assert.deepEqual([...v.gamut.data], [...v.grey.data], `${pixel} is painted its grey`);
  }
  // The press's own colours print: the sRGB renditions of the data's C, M, Y, R, G and B solids and of its 20%
  // magenta tint, absolute and after black-point compensation, and a mid-chroma red.
  const inv = (f) => (f * f * f > 216 / 24389 ? f * f * f : (116 * f - 16) * 27 / 24389);
  const Yp = inv((PRINT.faces[0][0][0][0] + 16) / 116), Yk = inv((PRINT.blackL + 16) / 116);
  const rendition = ([L, a, b], bpc) => {
    const fy = (L + 16) / 116, xyz = [0.96422 * inv(fy + a / 500), inv(fy), 0.82521 * inv(fy - b / 200)];
    const [X, Y, Z] = bpc ? xyz.map((v, i) => (v - Yk * [0.96422, 1, 0.82521][i]) / (Yp - Yk)) : xyz;
    const lin = [3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z, 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z];
    return [...lin.map((v) => Math.round(255 * toSRGB(Math.max(0, Math.min(1, v))))), 255];
  };
  const [cm, my, yc] = PRINT.faces, own = [yc[0][5], cm[0][5], my[0][5], my[5][5], yc[5][5], cm[5][5], cm[0][2]];
  const solids = view([...own.map((lab) => rendition(lab, false)), ...own.map((lab) => rendition(lab, true)), bytes('#c03030')]);
  assert.deepEqual({ ...solids.outside }, { share: 0, excess: 0 }, 'the data\'s solids and tints are inside');
  // Near-white grounds and pale tints the synthetic press prints within 0.02 of OKLab, as the reference gamut of
  // the test below measures them.
  for (const hex of ['#fffff0', '#ffffe0', '#f0fff0', '#e0e0ff', '#fffad5']) {
    assert.deepEqual({ ...view([bytes(hex)]).outside }, { share: 0, excess: 0 }, `${hex} is inside`);
  }
  // The other sRGB primary and pale colours the data cannot reach within 0.03 stay outside.
  for (const hex of ['#ff0000', '#ccffcc', '#ccffff']) assert.equal(view([bytes(hex)]).outside.share, 1, `${hex} is outside`);
  const mixed = view([bytes('#00ff00'), bytes('#9a7b64')]);
  assert.equal(mixed.outside.share, 0.5, 'one pixel of two is outside');
  assert.deepEqual([mixed.values, mixed.grey, mixed.deuteranopia, mixed.protanopia, mixed.tritanopia, mixed.peak], [null, null, null, null, null, null], 'views not asked for stay null');
  assert.equal(cellViews(rgbaImage(1, 1, () => bytes('#00ff00')), { values: true }).outside, null, 'no gamut without --gamut');
  // Fixed colour grids keep their share and excess, as the data's two-ink patches and its solids with black set them.
  const grids = [
    [rgbaImage(64, 64, (x, y) => [x * 4, y * 4, (x * 7 + y * 13) & 255, 255]), { share: 0.5264, excess: 0.1696 }],
    [rgbaImage(32, 32, (x, y) => [200 + x, 200 + y, 255 - x - y, 255]), { share: 0.0254, excess: 0.0298 }],
    [rgbaImage(32, 32, (x, y) => [x * 8, 255 - y * 8, 128, x * 8]), { share: 0.2285, excess: 0.068 }],
  ];
  for (const [image, outside] of grids) assert.deepEqual({ ...cellViews(image, only).outside }, outside, `a ${image.width}x${image.height} grid`);
  const edges = cellViews.gamutEdges;
  cellViews(grids[0][0], only);
  assert.equal(cellViews.gamutEdges, edges, 'the edges are built once and reused');
  // Other data builds other edges, and the first data's come back with it.
  const darker = { ...PRINT, blacks: PRINT.blacks.map((pair) => pair.map(([L, a, b]) => [L * 0.9, a, b])) };
  assert.notDeepEqual({ ...cellViews(grids[0][0], { gamut: darker }).outside }, grids[0][1], 'darker solids with black give the grid another share');
  assert.equal(cellViews.gamutEdges.data, darker, 'the edges follow the data');
  assert.deepEqual({ ...cellViews(grids[0][0], only).outside }, grids[0][1], 'and the first data gives its share again');
});

test('contact sheet: the print-gamut view searches each colour once and paints and counts as a search of every pixel would', () => {
  const only = { values: false, grey: false, colourVision: false, gamut: PRINT };
  // Copies of cellViews from its source holding no searched colour, or at most 8.
  const holding = (max) => {
    const source = cellViews.toString();
    assert.ok(source.includes('MAX_SEARCHED = 65536'), 'the source bounds its searched colours at 65536');
    return vm.runInThisContext(`(${source.replace('MAX_SEARCHED = 65536', `MAX_SEARCHED = ${max}`)})`);
  };
  // A saturated cell: on the left six primaries and secondaries in blocks that repeat down the rows, on the right a
  // sweep of hue across and of value down, each colour at four opacities in turn, nearly every pixel its own colour.
  const hsv = (h, v) => [5, 3, 1].map((n) => { const k = (n + h * 6) % 6; return Math.round(255 * v * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); });
  const image = rgbaImage(160, 96, (x, y) => (x < 60 ? [...hsv(((x >> 3) + (y >> 3)) % 6 / 6, 1), 255] : [...hsv((x - 60) / 100, 1 - (y >> 2) / 40), 255 - (y & 3) * 40]));
  const keys = new Set();
  for (let i = 0; i < image.data.length; i += 4) keys.add(image.data.slice(i, i + 4).join());
  assert.ok(keys.size > 5000 && image.width * image.height - keys.size > 5000, `many distinct and many repeated colours: ${keys.size} of ${image.width * image.height}`);
  const cached = cellViews(image, only);
  assert.ok(cached.outside.share > 0.3 && cached.outside.share < 0.9, `some pixels outside, some inside: ${cached.outside.share}`);
  for (const max of [0, 8]) {
    const fresh = holding(max)(image, only);
    assert.deepEqual({ ...fresh.outside }, { ...cached.outside }, `holding ${max} searched colours, the share and excess match`);
    assert.equal(fresh.gamut.data.findIndex((v, i) => v !== cached.gamut.data[i]), -1, `holding ${max} searched colours, every painted byte matches`);
  }
});

test('contact sheet: every cellViews view keeps its recorded output, alone or with the others, over flat runs and a varied ramp', () => {
  // Flat runs of a colour outside the gamut, paper, a half-transparent blue and transparency on the left; a ramp of
  // colour and opacity on the right.
  const flats = [[0, 255, 0, 255], [250, 250, 240, 255], [30, 40, 200, 128], [0, 0, 0, 0]];
  const image = rgbaImage(64, 40, (x, y) => (x < 24 ? flats[(y >> 3) % 4] : [x * 4, y * 6, (x * 7 + y * 13) & 255, 255 - (x & 3) * 60]));
  const digest = (v) => createHash('sha256').update(JSON.stringify(v, (k, x) => (x instanceof Uint8ClampedArray ? Buffer.from(x).toString('base64') : x))).digest('hex').slice(0, 16);
  const recorded = { values: '713c5ddf9e3d8b2c', grey: '9fcb9b9326717957', colourVision: '1a19bf945c3654d7', gamut: '583a4bbfb4bfa0bd', all: 'a56b301282ff3497' };
  const sets = { values: { values: true }, grey: { grey: true }, colourVision: { colourVision: true }, gamut: { gamut: PRINT }, all: { values: true, grey: true, colourVision: true, gamut: PRINT } };
  // The chroma readout and the samples have their own tests; leaving them out keeps these hashes pinned to the views.
  for (const [name, views] of Object.entries(sets)) assert.equal(digest({ ...cellViews(image, views), chroma: undefined, saturated: undefined, samples: undefined }), recorded[name], `${name}: every output as recorded`);
});

test('contact sheet: the print-gamut view refuses rings that do not rise in hue or do not darken level by level', () => {
  const pixel = rgbaImage(1, 1, () => [128, 128, 128, 255]);
  const edges = (cellViews(pixel, { gamut: PRINT }), cellViews.gamutEdges);
  // C+M and M swapped among the solids with black: the ring steps back from magenta to blue.
  const swapped = { ...PRINT, blacks: [PRINT.blacks[0], PRINT.blacks[2], PRINT.blacks[1], ...PRINT.blacks.slice(3)] };
  assert.throws(() => cellViews(pixel, { gamut: swapped }), /^Error: seeds: print-gamut ring 6 steps from hue [\d.]+ to [\d.]+ degrees at patch \d+; each ring must rise in hue at every step, so the --gamut view has no edge to test against$/);
  // The cyan solid with 40% black lighter than with 20%: level 7 rises above level 6 at cyan hues.
  const [k20, [L, a, b]] = PRINT.blacks[0];
  const lifted = { ...PRINT, blacks: [[k20, [k20[0] + 18, a, b]], ...PRINT.blacks.slice(1)] };
  assert.throws(() => cellViews(pixel, { gamut: lifted }), /^Error: seeds: print-gamut level 7 is not darker than level 6 at hue [\d.]+ degrees \(L [\d.]+ under [\d.]+\); each ring must be darker than the one before it at every hue, so the --gamut view has no edge to test against$/);
  assert.ok(L < k20[0], 'the data\'s own cyan with 40% black is darker than with 20%');
  assert.equal(cellViews.gamutEdges, edges, 'a refused build keeps the edges it found');
});

test('contact sheet: printData reads the patches the print-gamut view needs from FOGRA39L.txt\'s layout, and refuses what it cannot read', async (t) => {
  const text = fs.readFileSync(PRINT_FILE, 'utf8');
  // The fields by name, in any order, with others between them, and CRLF endings.
  const rows = text.split('\n'), format = rows.indexOf('BEGIN_DATA_FORMAT') + 1, begin = rows.indexOf('BEGIN_DATA');
  const order = [0, 5, 6, 7, 1, 2, 3, 4], swap = (row) => { const v = row.split('\t'); return [...order.map((i) => v[i]), 'x'].join('\t'); };
  const moved = [...rows.slice(0, format), swap(rows[format]).replace(/x$/, 'SAMPLE_NAME'), ...rows.slice(format + 1, begin + 1),
    ...rows.slice(begin + 1, rows.indexOf('END_DATA')).map(swap), ...rows.slice(rows.indexOf('END_DATA'))].join('\r\n');
  assert.deepEqual(printData(moved, 'moved.txt'), PRINT, 'fields are found by name');
  // A repeated patch: the first line counts.
  const paper = rows.find((row) => /^\d+\t0\t0\t0\t0\t/.test(row));
  const twice = text.replace(`\n${paper}\n`, `\n${paper}\n${paper.replace(/\t[\d.-]+$/, '\t9.99')}\n`);
  assert.notEqual(twice, text);
  assert.deepEqual(printData(twice, 'twice.txt'), PRINT, 'a repeated patch keeps its first line');
  assert.equal(PRINT.faces[0][0][0][0], 94.75, 'the paper patch\'s L, as the fixture gives it');
  const hint = 'download FOGRA39L.txt, Fogra\'s data for offset printing on coated paper, from https://registry.color.org/cmyk-registry/fogra39 and pass its path, such as --gamut FOGRA39L.txt';
  assert.throws(() => printData('CGATS.17\n', 'empty.txt'), { message: `seeds: empty.txt holds no BEGIN_DATA_FORMAT ... END_DATA_FORMAT and BEGIN_DATA ... END_DATA blocks, so it is not characterization data in the layout of FOGRA39L.txt; ${hint}` });
  assert.throws(() => printData(text.replace('\tLAB_A\t', '\tLAB_X\t'), 'nolab.txt'), { message: `seeds: nolab.txt has no LAB_A field; the print-gamut view reads each patch's CMYK coverage and CIELAB, as FOGRA39L.txt holds them; ${hint}` });
  const cyan = rows.find((row) => /^\d+\t100\t0\t0\t20\t/.test(row));
  assert.throws(() => printData(text.replace(`${cyan}\n`, ''), 'short.txt'), { message: 'seeds: short.txt has no patch C100 M0 Y0 K20; the print-gamut view reads the tints of C, M and Y at 10, 20, 40, 70, 100% with their two-ink patches, the solids with 20 and 40% black, and C, M and K 100%, as FOGRA39L.txt holds them; pass the whole file the registry publishes' });
  const line = rows.indexOf(cyan) + 1;
  assert.throws(() => printData(text.replace(cyan, cyan.replace(/\t[\d.-]+$/, '')), 'cut.txt'), { message: `seeds: cut.txt line ${line} holds 7 values where its data format names 8 fields, or a CMYK or LAB value that is not a number: ${cyan.replace(/\t[\d.-]+$/, '')}` });
  // A file seeds cannot read is refused before anything is written.
  const argv = process.argv, missing = path.join(os.tmpdir(), 'artifex-no-such-FOGRA39L.txt');
  t.after(() => { process.argv = argv; });
  process.argv = [process.execPath, 'contact-sheet.js', 'drift', '--gamut', missing];
  await assert.rejects(main(), { message: `seeds: --gamut cannot read ${missing}: ENOENT; nothing was written; ${hint}` });
  // So is a file it reads but cannot use.
  const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-gamut-')), 'FOGRA39L.txt');
  t.after(() => fs.rmSync(path.dirname(empty), { recursive: true, force: true }));
  fs.writeFileSync(empty, 'CGATS.17\n');
  process.argv = [process.execPath, 'contact-sheet.js', 'drift', '--gamut', empty];
  await assert.rejects(main(), { message: `seeds: ${empty} holds no BEGIN_DATA_FORMAT ... END_DATA_FORMAT and BEGIN_DATA ... END_DATA blocks, so it is not characterization data in the layout of FOGRA39L.txt; ${hint}; nothing was written` });
});

// Every patch [C, M, Y, K, L, a, b] of characterization data in the layout of FOGRA39L.txt, its fields read as
// printData reads them.
function patchRows(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const fields = lines.slice(lines.indexOf('BEGIN_DATA_FORMAT') + 1, lines.indexOf('END_DATA_FORMAT')).join(' ').split(/\s+/);
  const column = ['CMYK_C', 'CMYK_M', 'CMYK_Y', 'CMYK_K', 'LAB_L', 'LAB_A', 'LAB_B'].map((name) => fields.indexOf(name));
  return lines.slice(lines.indexOf('BEGIN_DATA') + 1, lines.indexOf('END_DATA')).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const words = l.split(/\s+/); return column.map((c) => Number(words[c])); });
}

// The reference print gamut that the print-gamut view's Limits text counts against, built from the patches
// [C, M, Y, K, L, a, b] of characterization data with the view's black-point compensation (the paper and black L
// of `data`, read from the tool), taking a patch no lighter than black as black. It is two closed triangle meshes in OKLab: the surface of the
// CMY cube without black, each cell of its measured grid split in two each way in linear light, and the hexagon of
// the solids and overprints at 0, 20, 40, 60, 80 and 100% black, each edge taken at the cube's coverages, linear in
// linear light between the coverages measured at that black, and capped at CMY 100% and at CMYK 100%. `distance`
// gives a colour's OKLab distance to the union of the two: 0 inside either mesh, else the nearest triangle's.
function printGamutReference(patches, data) {
  const inv = (f) => (f * f * f > 216 / 24389 ? f * f * f : (116 * f - 16) * 27 / 24389);
  // The tool's paper and black L, read from the edges its gamut view builds from `data`.
  cellViews(rgbaImage(1, 1, () => [0, 0, 0, 255]), { values: false, grey: false, colourVision: false, gamut: data });
  const { paperL, blackL } = cellViews.gamutEdges;
  assert.equal(patches.find((p) => p.slice(0, 4).join() === '100,100,0,100')[4], blackL, 'the tool\'s black is the data\'s C100 M100 Y0 K100 patch');
  assert.equal(patches.find((p) => p.slice(0, 4).every((v) => v === 0))[4], paperL, 'the tool\'s paper is the data\'s C0 M0 Y0 K0 patch');
  const Yp = inv((paperL + 16) / 116), Yk = inv((blackL + 16) / 116);
  const linOf = ([L, a, b]) => {
    if (L <= blackL) return [0, 0, 0];
    const fy = (L + 16) / 116, bpc = (v, w) => (v - Yk * w) / (Yp - Yk);
    const X = bpc(0.96422 * inv(fy + a / 500), 0.96422), Y = bpc(inv(fy), 1), Z = bpc(0.82521 * inv(fy - b / 200), 0.82521);
    return [3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z, 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z];
  };
  // Linear sRGB to OKLab; a mix darker than black that falls outside the cone of real colours clips into it.
  const oklab = ([r, g, b]) => {
    const l = Math.cbrt(Math.max(0, 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b));
    const m = Math.cbrt(Math.max(0, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b));
    const s = Math.cbrt(Math.max(0, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b));
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  };
  // A repeated patch keeps its first line, as printData keeps it.
  const at = new Map();
  for (const [c, m, y, k, ...lab] of patches) if (!at.has(`${c},${m},${y},${k}`)) at.set(`${c},${m},${y},${k}`, linOf(lab));
  const get = (c, m, y, k) => at.get(`${c},${m},${y},${k}`) ?? assert.fail(`no patch C${c} M${m} Y${y} K${k} in the data`);
  const mix = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
  const LV = [0, 10, 20, 30, 40, 55, 70, 85, 100], SUB = 2, n = (LV.length - 1) * SUB, cubeTris = [], blackTris = [];
  const vertex = new Map();
  // The cube's surface point at sub-grid (i, j, k), bilinear in linear light within its face's measured cell.
  const vert = (...ijk) => {
    const key = ijk.join();
    if (!vertex.has(key)) {
      const cell = ijk.map((v) => Math.min(LV.length - 2, Math.floor(v / SUB))), f = ijk.map((v, x) => v / SUB - cell[x]);
      const sum = [0, 0, 0];
      for (let a = 0; a < 8; a++) {
        const bit = (x) => (a >> x) & 1, w = (bit(0) ? f[0] : 1 - f[0]) * (bit(1) ? f[1] : 1 - f[1]) * (bit(2) ? f[2] : 1 - f[2]);
        // On a face the fixed coverage has weight 0 or 1, so only that face's patches count.
        if (w) get(LV[cell[0] + bit(0)], LV[cell[1] + bit(1)], LV[cell[2] + bit(2)], 0).forEach((v, x) => { sum[x] += w * v; });
      }
      vertex.set(key, oklab(sum));
    }
    return vertex.get(key);
  };
  const quad = (tris, p, q, r, s) => tris.push([p, q, r], [p, r, s]);
  for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) for (const f of [0, n]) {
    quad(cubeTris, vert(f, u, v), vert(f, u + 1, v), vert(f, u + 1, v + 1), vert(f, u, v + 1));
    quad(cubeTris, vert(u, f, v), vert(u + 1, f, v), vert(u + 1, f, v + 1), vert(u, f, v + 1));
    quad(cubeTris, vert(u, v, f), vert(u + 1, v, f), vert(u + 1, v + 1, f), vert(u, v + 1, f));
  }
  const corners = [[100, 0, 0], [100, 100, 0], [0, 100, 0], [0, 100, 100], [0, 0, 100], [100, 0, 100]], KS = [0, 20, 40, 60, 80, 100];
  const rings = KS.map((k) => corners.flatMap((p, e) => {
    const q = corners[(e + 1) % 6], x = p.findIndex((v, i) => v !== q[i]), cov = (t) => p.map((v, i) => (i === x ? t : v));
    const measured = LV.filter((t) => at.has(`${cov(t)},${k}`));
    return (p[x] === 0 ? LV : [...LV].reverse()).slice(0, -1).map((t) => {
      const j = Math.max(0, measured.findLastIndex((c) => c <= t)), t0 = measured[j], t1 = measured[Math.min(j + 1, measured.length - 1)];
      return oklab(mix(get(...cov(t0), k), get(...cov(t1), k), t1 === t0 ? 0 : (t - t0) / (t1 - t0)));
    });
  }));
  const N = rings[0].length, top = oklab(get(100, 100, 100, 0)), bottom = oklab(get(100, 100, 100, 100));
  for (let r = 0; r + 1 < rings.length; r++) for (let i = 0; i < N; i++) quad(blackTris, rings[r][i], rings[r][(i + 1) % N], rings[r + 1][(i + 1) % N], rings[r + 1][i]);
  for (let i = 0; i < N; i++) blackTris.push([top, rings[0][(i + 1) % N], rings[0][i]], [bottom, rings[KS.length - 1][i], rings[KS.length - 1][(i + 1) % N]]);
  const meshes = [cubeTris, blackTris].map((tris) => Float64Array.from(tris.flat(2)));
  // Inside a closed mesh when a ray from the point crosses it an odd number of times (Möller and Trumbore's test).
  const D0 = 0.5773, D1 = 0.6123, D2 = 0.5401;
  const inside = (t, p0, p1, p2) => {
    let count = 0;
    for (let i = 0; i < t.length; i += 9) {
      const a0 = t[i], a1 = t[i + 1], a2 = t[i + 2], e0 = t[i + 3] - a0, e1 = t[i + 4] - a1, e2 = t[i + 5] - a2, f0 = t[i + 6] - a0, f1 = t[i + 7] - a1, f2 = t[i + 8] - a2;
      const h0 = D1 * f2 - D2 * f1, h1 = D2 * f0 - D0 * f2, h2 = D0 * f1 - D1 * f0, det = e0 * h0 + e1 * h1 + e2 * h2;
      if (Math.abs(det) < 1e-15) continue;
      const s0 = p0 - a0, s1 = p1 - a1, s2 = p2 - a2, u = (s0 * h0 + s1 * h1 + s2 * h2) / det;
      if (u < 0 || u > 1) continue;
      const q0 = s1 * e2 - s2 * e1, q1 = s2 * e0 - s0 * e2, q2 = s0 * e1 - s1 * e0, v = (D0 * q0 + D1 * q1 + D2 * q2) / det;
      if (v >= 0 && u + v <= 1 && (f0 * q0 + f1 * q1 + f2 * q2) / det > 0) count++;
    }
    return count % 2 === 1;
  };
  // The distance from p to the triangle a, a + e, a + f: the nearest point minimises over the triangle's
  // barycentric coordinates, clamped to its edges (Ericson, Real-Time Collision Detection, 5.1.5).
  const triangle = (t, i, p0, p1, p2) => {
    const a0 = t[i], a1 = t[i + 1], a2 = t[i + 2], e0 = t[i + 3] - a0, e1 = t[i + 4] - a1, e2 = t[i + 5] - a2, f0 = t[i + 6] - a0, f1 = t[i + 7] - a1, f2 = t[i + 8] - a2;
    const w0 = p0 - a0, w1 = p1 - a1, w2 = p2 - a2, ee = e0 * e0 + e1 * e1 + e2 * e2, ef = e0 * f0 + e1 * f1 + e2 * f2, ff = f0 * f0 + f1 * f1 + f2 * f2;
    const we = w0 * e0 + w1 * e1 + w2 * e2, wf = w0 * f0 + w1 * f1 + w2 * f2, det = ee * ff - ef * ef;
    const at = (u, v) => Math.hypot(w0 - u * e0 - v * f0, w1 - u * e1 - v * f1, w2 - u * e2 - v * f2);
    const clamp = (x) => Math.max(0, Math.min(1, x));
    let u = (we * ff - wf * ef) / det, v = (wf * ee - we * ef) / det;
    if (det > 1e-18 && u >= 0 && v >= 0 && u + v <= 1) return at(u, v);
    // Otherwise the nearest point lies on an edge: a to a + e, a to a + f, or a + e to a + f.
    u = ee ? clamp(we / ee) : 0; v = ff ? clamp(wf / ff) : 0;
    const gg = ee - 2 * ef + ff, g = gg ? clamp((wf - we - ef + ee) / gg) : 0;
    return Math.min(at(u, 0), at(0, v), at(1 - g, g));
  };
  // Each triangle's centroid and the radius of the sphere about it that holds the triangle: the triangle is no nearer
  // than the centroid's distance less the radius, and no farther than the centroid's distance.
  const spheres = meshes.map((t) => {
    const s = new Float64Array((t.length / 9) * 4);
    for (let i = 0, j = 0; i < t.length; i += 9, j += 4) {
      for (let x = 0; x < 3; x++) s[j + x] = (t[i + x] + t[i + 3 + x] + t[i + 6 + x]) / 3;
      s[j + 3] = Math.max(...[0, 3, 6].map((v) => Math.hypot(t[i + v] - s[j], t[i + v + 1] - s[j + 1], t[i + v + 2] - s[j + 2])));
    }
    return s;
  });
  return {
    distance: ([p0, p1, p2]) => {
      if (meshes.some((t) => inside(t, p0, p1, p2))) return 0;
      let d = Infinity;
      for (const s of spheres) for (let j = 0; j < s.length; j += 4) d = Math.min(d, Math.hypot(p0 - s[j], p1 - s[j + 1], p2 - s[j + 2]));
      meshes.forEach((t, m) => {
        for (let i = 0, j = 0; i < t.length; i += 9, j += 4) {
          const s = spheres[m];
          if (Math.hypot(p0 - s[j], p1 - s[j + 1], p2 - s[j + 2]) - s[j + 3] < d) d = Math.min(d, triangle(t, i, p0, p1, p2));
        }
      });
      return d;
    },
    oklabOf: (lab) => oklab(linOf(lab)),
    oklab,
  };
}

// The view's verdict on every sRGB colour whose channels are multiples of 17 against the reference gamut of the
// characterization data in `file`: the counts of colours outside, false flags and false passes, and helpers.
function printGamutLimits(file) {
  // The patches the reference is built from: without black, the surface of the CMY cube at the coverages LV; with 20
  // to 100% black, the edges between the solids and overprints, one ink 100%, one 0%; and C, M, Y and K 100%.
  const LV = [0, 10, 20, 30, 40, 55, 70, 85, 100];
  const used = ([c, m, y, k]) => [c, m, y].every((v) => LV.includes(v)) && (k === 0 ? [c, m, y].some((v) => v === 0 || v === 100)
    : [20, 40, 60, 80, 100].includes(k) && (([c, m, y].includes(0) && [c, m, y].includes(100)) || c + m + y + k === 400));
  const text = fs.readFileSync(file, 'utf8'), patches = patchRows(text).filter(used), data = printData(text, file);
  const reference = printGamutReference(patches, data);
  // Every measured patch lies on or inside the reference gamut.
  const off = patches.filter((p) => reference.distance(reference.oklabOf(p.slice(4))) > 1e-9);
  assert.deepEqual(off.map((p) => p.slice(0, 4).join('/')), [], 'patches outside the reference gamut');
  // Every sRGB colour whose channels are multiples of 17, with its distance from the reference gamut.
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)), grid = [];
  const colour = (r, g, b) => ({ hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''), rgba: [r, g, b, 255], d: reference.distance(reference.oklab([r, g, b].map((v) => lin(v / 255)))) });
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) grid.push(colour(r, g, b));
  const only = { values: false, grey: false, colourVision: false, gamut: data };
  const view = (colours) => cellViews(rgbaImage(colours.length, 1, (x) => colours[x].rgba), only);
  const painted = view(grid).gamut.data;
  grid.forEach((c, x) => { c.flagged = painted[x * 4] === 255 && painted[x * 4 + 1] === 0 && painted[x * 4 + 2] === 255; });
  const flags = grid.filter((c) => c.flagged && c.d <= 0.02), passes = grid.filter((c) => !c.flagged && c.d > 0.02);
  const got = {
    colours: grid.length, outside: grid.filter((c) => c.d > 0.02).length,
    flags: flags.length, flagExcess: flags.length ? view(flags).outside.excess : 0,
    passes: passes.length, passMiss: +Math.max(0, ...passes.map((c) => c.d)).toFixed(4),
  };
  const named = (hex) => {
    const c = colour(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    return { ...c, flagged: view([c]).outside.share === 1 };
  };
  return { got, flags, passes, named, view, colour, said: `flagged inside: ${flags.map((c) => c.hex).join(' ')}; passed outside: ${passes.map((c) => c.hex).join(' ')}` };
}

test('contact sheet: the print-gamut view keeps its false flags and false passes against a denser reference of the synthetic data', () => {
  const { got, flags, passes, named, said } = printGamutLimits(PRINT_FILE);
  // The model between the view's patches errs both ways against the denser reference, by little.
  assert.deepEqual(got, { colours: 4096, outside: 2330, flags: 61, flagExcess: 0.032, passes: 14, passMiss: 0.0237 }, said);
  for (const c of [...flags, ...passes]) assert.ok(Math.abs(c.d - 0.02) < 0.03, `${c.hex} errs by little: ${c.d}`);
  for (const hex of ['#00ff00', '#0000ff', '#ff0000', '#000080']) assert.ok(named(hex).d > 0.02 && named(hex).flagged, `${hex} is outside and flagged`);
  for (const hex of ['#fffff0', '#e0e0ff', '#808080']) assert.ok(named(hex).d <= 0.02 && !named(hex).flagged, `${hex} is inside and passed`);
});

// With Fogra's FOGRA39L.txt, which Artifex does not ship, the counts and examples docs/knowledge/command-line-tools.md
// gives under Limits; a change to the gamut changes them there too.
test('contact sheet: the print-gamut view keeps the false flags and false passes its Limits text counts against FOGRA39L', { skip: !process.env.ARTIFEX_FOGRA39L && 'set ARTIFEX_FOGRA39L to the path of FOGRA39L.txt to run it' }, () => {
  const { got, flags, passes, named, view, colour, said } = printGamutLimits(process.env.ARTIFEX_FOGRA39L);
  assert.deepEqual(got, { colours: 4096, outside: 1912, flags: 34, flagExcess: 0.0265, passes: 9, passMiss: 0.0215 }, said);
  // The examples the Limits text names, with the reference's distance and the view's verdict.
  for (const hex of ['#9900aa', '#33bb00', '#00ccbb', '#000080', '#ccffcc', '#e0ffe0', '#ccffff', '#ffff99']) {
    assert.ok(named(hex).d > 0.02 && named(hex).flagged, `${hex} is outside and flagged`);
  }
  // The documented excess of navy is about 0.09 with this black; a black of L 16 would give about 0.04.
  assert.ok(Math.abs(view([colour(0, 0, 128)]).outside.excess - 0.086) < 0.01, 'navy #000080 lies about 0.086 outside');
  for (const hex of ['#fffff0', '#ffffcc', '#e0e0ff', '#f0fff0']) assert.ok(named(hex).d <= 0.02 && !named(hex).flagged, `${hex} is inside and passed`);
  const hexes = (list) => list.map((c) => c.hex);
  for (const hex of ['#eeee00', '#ffffbb', '#0077cc', '#66aaee', '#447700', '#99cc22', '#ee3399', '#ffccee', '#ee0000', '#220033', '#440044']) assert.ok(hexes(flags).includes(hex), `${hex} is a false flag`);
  for (const hex of ['#22bb99', '#66ccbb', '#44ccee', '#883399', '#ff9999', '#ff99aa']) assert.ok(hexes(passes).includes(hex), `${hex} is a false pass`);
});

test('contact sheet: a sheet or strip with --gamut reports each cell\'s share outside the print gamut and draws its view', () => {
  const views = { values: false, grey: false, colourVision: false, gamut: PRINT };
  const green = (w, h) => new Uint8ClampedArray(w * h * 4).fill(255).map((v, i) => (i % 4 === 0 || i % 4 === 2 ? 0 : v));
  // Cells 240 x 160 pixels, not 640 wide: every pixel is one colour, so the shares and excess do not depend on the size,
  // and each outside pixel's search of the gamut's edges is the cost.
  const strip = { frames: 3, scale: 0.25 };
  const painted = runStrip(strip, {}, 'readout', [], 3, null, null, null, views, green);
  assert.equal(painted.window.__sheet.cells.length, 3);
  assert.ok(painted.window.__sheet.cells.every((cell) => cell.gamut.share === 1 && cell.gamut.excess > 0.15), 'every pure-green cell lies outside');
  assert.equal(painted.elements.filter((el) => el.tag === 'figcaption' && typeof el.textContent === 'string' && el.textContent.startsWith('print gamut')).length, 3, 'one print-gamut caption per cell');
  // The stand-in canvases read back transparent pixels, which lie on white.
  assert.ok(runStrip(strip, {}, 'readout', [], 3, null, null, null, views).window.__sheet.cells.every((cell) => cell.gamut.share === 0), 'a white cell lies inside');
  assert.ok(painted.window.__sheet.cells.every((cell) => typeof cell.viewMs === 'number' && cell.viewMs >= 0), 'each cell times its views');
  assert.equal(painted.elements.filter((el) => typeof el.textContent === 'string' && / · views [\d.]+ ms · detail /.test(el.textContent)).length, 3, 'each stats line shows the view time');
  const plain = runStrip(null, {}, 'drift', [], 2).window.__sheet.cells;
  assert.ok(plain.every((cell) => !('gamut' in cell)), 'a sheet without --gamut has no gamut key');
  assert.ok(plain.every((cell) => cell.viewMs === null), 'a sheet without views has no view time');
});

test('contact sheet: a sheet or strip with views draws them under each cell and reports the peak in design units', () => {
  const all = { values: true, grey: true, colourVision: true };
  // Cells 48 x 32 pixels, not 640 wide: the stand-in canvases read back one flat colour, so nothing here depends on the size.
  const strip = { frames: 3, scale: 0.05 };
  const plain = runStrip(strip);
  const viewed = runStrip(strip, {}, 'readout', [], 3, null, null, null, all);
  assert.equal(viewed.cells.length - plain.cells.length, 15, 'five views under each of three cells');
  const captions = viewed.elements.filter((el) => el.tag === 'figcaption' && typeof el.textContent === 'string').map((el) => el.textContent);
  for (const start of ['values:', 'greyscale', 'deuteranopia', 'protanopia', 'tritanopia']) {
    assert.equal(captions.filter((text) => text.startsWith(start)).length, 3, start);
  }
  // The stand-in canvases read back transparent pixels, which lie flat on white.
  assert.ok(viewed.window.__sheet.cells.every((cell) => cell.peak === null && cell.lightness.mean === 1), 'a flat cell has no peak');
  assert.ok(plain.window.__sheet.cells.every((cell) => !('peak' in cell) && cell.lightness.mean === 1), 'without views a strip cell has its lightness and no peak');
  const sheet = runStrip(null, {}, 'drift', [], 2, null, null, null, { values: false, grey: true, colourVision: false });
  assert.equal(sheet.elements.filter((el) => el.tag === 'figcaption' && el.textContent === 'greyscale (OKLCh lightness)').length, 2, 'a seed sheet gets them too');
  assert.ok(sheet.window.__sheet.cells.every((cell) => !('peak' in cell)), 'no peak without --values');
  const html = page(['readout'], 3, 1, [], null, null, { frames: 3 }, null, null, all);
  assert.doesNotThrow(() => new vm.Script([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
  assert.ok(!page(['drift'], 3, 1).includes('function cellViews'), 'without views a seed sheet is unchanged');
});

test('contact sheet: every time-strip cell reports the mean, min, max, range, p5 and p95 of its OKLCh lightness, with or without views', () => {
  // Left half opaque black, right half white: L runs from 0 to 1 and averages 0.5.
  const halves = (w, h) => {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
    return data;
  };
  const { window } = runStrip({ frames: 3 }, {}, 'readout', [], 3, null, null, null, null, halves);
  const cells = window.__sheet.cells;
  assert.equal(cells.length, 3);
  for (const [i, cell] of cells.entries()) assert.deepEqual({ ...cell.lightness }, { mean: 0.5, min: 0, max: 1, range: 1, p5: 0, p95: 1 }, `cell ${i}`);
  near(cellViews(greyImage(4, 1, (x) => [40, 40, 200, 200][x]), {}).lightness.range, lightnessOf(200) - lightnessOf(40), 'range is max minus min', 1e-4);
  // Nearest rank on 20 pixels: p5 is the 1st lowest (ceil(0.05 * 20)) and p95 the 19th. One rank up changes p5 (the 2nd
  // is white) and one rank down changes p95 (the 18th is white); a rank down cannot change p5, as the rank is at least 1.
  const ranked = (blacks, n = 20) => cellViews(greyImage(n, 1, (x) => (x < blacks ? 0 : 255)), {}).lightness;
  assert.equal(ranked(1).p5, 0, 'p5 is the 1st lowest pixel, black, not the 2nd');
  assert.equal(ranked(19).p95, 0, 'p95 is the 19th lowest pixel, black, not the 20th');
  assert.equal(ranked(18).p95, 1, 'p95 is the 19th lowest pixel, white, not the 18th');
  // A rank that is not a whole number rounds up: ceil(1.5) = 2 and ceil(28.5) = 29 on 30 pixels, ceil(1.25) = 2 and
  // ceil(23.75) = 24 on 25, so floor and round-to-nearest each take the rank below on at least one of these.
  assert.equal(ranked(1, 30).p5, 1, '30 pixels: p5 is the 2nd lowest, white, not the 1st');
  assert.equal(ranked(2, 30).p5, 0, '30 pixels: p5 is the 2nd lowest, black');
  assert.equal(ranked(28, 30).p95, 1, '30 pixels: p95 is the 29th lowest, white, not the 28th');
  assert.equal(ranked(29, 30).p95, 0, '30 pixels: p95 is the 29th lowest, black');
  assert.equal(ranked(1, 25).p5, 1, '25 pixels: p5 is the 2nd lowest, white, not the 1st');
  assert.equal(ranked(23, 25).p95, 1, '25 pixels: p95 is the 24th lowest, white, not the 23rd');
  assert.equal(ranked(24, 25).p95, 0, '25 pixels: p95 is the 24th lowest, black');
  const sheet = runStrip(null, {}, 'drift', [], 2, null, null, null, null, halves);
  assert.ok(sheet.window.__sheet.cells.every((cell) => !('lightness' in cell) && !('chroma' in cell) && !('saturated' in cell)), 'a seed sheet without views reports none');
});

test('contact sheet: cellViews takes chroma p50 and p95 by nearest rank, rounding a fractional rank up', () => {
  const red = [208, 32, 32, 255], grey = [128, 128, 128, 255], redC = oklch('#d02020')[1];
  // `reds` red pixels after grey ones in a row of `n`: grey has no chroma, so a percentile reads one or the other.
  const chroma = (n, reds) => cellViews(rgbaImage(n, 1, (x) => (x >= n - reds ? red : grey)), {}).chroma;
  const is = (got, want, what) => near(got, want, what, 1e-3);
  // 25 pixels: p50 is the ceil(12.5) = 13th lowest; p95 the ceil(23.75) = 24th.
  is(chroma(25, 12).p50, 0, 'p50 of 25 with 13 grey is the 13th lowest, grey, not the 14th');
  is(chroma(25, 13).p50, redC, 'p50 of 25 with 12 grey is the 13th lowest, red, not the 12th');
  is(chroma(25, 2).p95, redC, 'p95 of 25 with 23 grey is the 24th lowest, red, not the 23rd');
  is(chroma(25, 1).p95, 0, 'p95 of 25 with 24 grey is the 24th lowest, grey');
  // 30 pixels: p95 is the ceil(28.5) = 29th lowest.
  is(chroma(30, 2).p95, redC, 'p95 of 30 with 28 grey is the 29th lowest, red, not the 28th');
  is(chroma(30, 1).p95, 0, 'p95 of 30 with 29 grey is the 29th lowest, grey, not the 30th');
  // 32 pixels: p95 is the ceil(30.4) = 31st lowest; the fraction .4 is below .5, so round-to-nearest takes the 30th.
  is(chroma(32, 2).p95, redC, 'p95 of 32 with 30 grey is the 31st lowest, red, not the 30th');
  is(chroma(32, 1).p95, 0, 'p95 of 32 with 31 grey is the 31st lowest, grey, not the 32nd');
});

test('contact sheet: cellViews reports OKLCh chroma percentiles and the most saturated small areas', () => {
  // A pale ground with a small saturated square at (40, 8) and a larger low-chroma patch at (4, 20); `patch` paints it.
  const ground = [232, 228, 220, 255], red = [208, 32, 32, 255];
  const frame = (patch) => rgbaImage(64, 40, (x, y) => (x >= 40 && x < 46 && y >= 8 && y < 14 ? red : x >= 4 && x < 24 && y >= 20 && y < 32 ? patch : ground));
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  const deg = (c) => (oklch(hex(c))[2] * 180) / Math.PI;
  const plain = cellViews(frame([150, 130, 110, 255]), {});
  near(plain.chroma.max, oklch(hex(red))[1], 'max is the square\'s chroma', 1e-4);
  near(plain.chroma.p50, oklch(hex(ground))[1], 'the median is the ground\'s chroma', 0.001);
  assert.equal(plain.chroma.high, +(36 / 2560).toFixed(4), 'only the square is over C 0.1');
  assert.equal(plain.chroma.areas, 1, 'one area over C 0.1: the square');
  const top = plain.saturated[0];
  assert.ok(plain.saturated.length >= 1 && plain.saturated.length <= 3, `one to three areas: ${plain.saturated.length}`);
  assert.deepEqual([top.x, top.y, top.w, top.h], [40, 8, 6, 6], 'the first area is the square, blocks of one pixel at width 64');
  near(top.chroma, oklch(hex(red))[1], 'its chroma', 1e-3);
  assert.ok(Math.abs(top.hue - deg(red)) < 1, `its hue ${top.hue} is the square's ${deg(red)}`);
  near(top.share, 36 / 2560, 'its share', 1e-4);
  const grey = cellViews(greyImage(32, 8, (x) => x * 8), {});
  assert.ok(grey.chroma.max < 1e-3, `a grey ramp has no chroma: ${grey.chroma.max}`);
  assert.equal(grey.saturated.length, 0, 'and no saturated area');
  // The patch tinted by a saturated light is found and counted.
  const tinted = cellViews(frame([200, 120, 40, 255]), {});
  const lit = tinted.saturated.find((a) => a.x === 4 && a.y === 20);
  assert.ok(lit && lit.w === 20 && lit.h === 12 && lit.chroma > 0.1, `the tinted patch is an area over C 0.1: ${JSON.stringify(tinted.saturated)}`);
  assert.equal(tinted.saturated[0].x, 40, 'the square stays the most saturated');
  assert.equal(tinted.chroma.high, +((36 + 240) / 2560).toFixed(4), 'the tinted patch counts as high chroma');
});

test('contact sheet: chroma.areas counts every area over C 0.1, listed or not', () => {
  // Blocks of one pixel at width 64; 4 px squares 4 px apart, so no two touch even on a corner.
  const ground = [232, 228, 220, 255], low = [150, 130, 110, 255];
  const squares = [[208, 32, 32, 255], [40, 60, 230, 255], [40, 170, 70, 255], [220, 120, 30, 255], [200, 40, 180, 255]];
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  for (const c of squares) assert.ok(oklch(hex(c))[1] > 0.1, `${hex(c)} is over C 0.1`);
  const lowC = oklch(hex(low))[1];
  assert.ok(lowC > 0.03 && lowC < 0.1, `the patch is between C 0.03 and 0.1: ${lowC}`);
  // `count` squares in a row at y 4, and the low-chroma patch at (50, 20) when `patch` is set.
  const frame = (count, patch) => rgbaImage(64, 40, (x, y) => {
    const k = Math.floor((x - 4) / 8);
    if (y >= 4 && y < 8 && x >= 4 && k < count && (x - 4) % 8 < 4) return squares[k];
    return patch && x >= 50 && x < 54 && y >= 20 && y < 24 ? low : ground;
  });
  const five = cellViews(frame(5, false), {});
  assert.equal(five.saturated.length, 3, 'three areas listed');
  assert.equal(five.chroma.areas, 5, 'five areas over C 0.1: a full list is not every area');
  const two = cellViews(frame(2, true), {});
  assert.equal(two.saturated.length, 3, 'two squares and the patch listed');
  assert.equal(two.chroma.areas, 2, 'the patch is listed but not counted');
  assert.equal(cellViews(greyImage(32, 8, (x) => x * 8), {}).chroma.areas, 0, 'a grey ramp has no area over C 0.1');
});

test('contact sheet: a saturated area keeps one form whole, splits touching hues and lists the most saturated first', () => {
  // At 640 pixels wide the blocks are 10 pixels, so forms only partly cover their edge blocks.
  const page = [245, 243, 238, 255], red = [210, 40, 40, 255], green = [40, 170, 70, 255];
  const areas = (paint) => cellViews(rgbaImage(640, 400, (x, y) => paint(x, y) || page), {}).saturated;
  const show = (list) => JSON.stringify(list);
  // A red disc with a soft edge 15 pixels wide, and a smaller green disc that a split red disc would push off the list.
  const discs = areas((x, y) => {
    const dr = Math.hypot(x - 160, y - 200), t = Math.min(1, (63 - dr) / 15);
    if (dr < 63) return page.map((v, i) => (i < 3 ? Math.round(v + t * (red[i] - v)) : 255));
    return Math.hypot(x - 460, y - 200) < 47 ? green : null;
  });
  assert.equal(discs.length, 2, `one area per disc: ${show(discs)}`);
  // Its outermost pixels are nearly the page's colour, so the box need only reach within a block of the disc's rim.
  assert.ok(discs[0].x <= 107 && discs[0].x + discs[0].w >= 213 && discs[0].hue < 60, `the red disc whole: ${show(discs[0])}`);
  assert.ok(discs[1].x <= 413 && discs[1].x + discs[1].w >= 507 && discs[1].hue > 120 && discs[1].hue < 180, `the green disc listed: ${show(discs[1])}`);
  // A red wedge narrowing from 40 pixels to 1 along its length.
  const taper = areas((x, y) => (x >= 100 && x < 500 && Math.abs(y - 200) < 20 - ((x - 100) * 19.5) / 400 ? red : null));
  assert.ok(taper.length === 1 && taper[0].x === 100 && taper[0].w >= 380, `the wedge is one area: ${show(taper)}`);
  // A red rectangle touching a green one: two areas, each with its own hue, never a mixed one.
  const touching = areas((x, y) => (y >= 100 && y < 300 && x >= 100 && x < 300 ? (x < 200 ? red : green) : null));
  assert.deepEqual(touching.map((a) => [a.x, a.w]), [[100, 100], [200, 100]], `one area per rectangle: ${show(touching)}`);
  assert.ok(touching[0].hue < 60 && touching[1].hue > 120 && touching[1].hue < 180, `each keeps its hue: ${show(touching)}`);
  // A large pale orange square seeded first in reading order, and a small more saturated blue block later: the blue comes first.
  const order = areas((x, y) => (x >= 50 && x < 250 && y >= 50 && y < 250 ? [200, 120, 60, 255] : x >= 400 && x < 410 && y >= 300 && y < 310 ? [40, 60, 230, 255] : null));
  assert.deepEqual(order.map((a) => a.x), [400, 50], `most saturated first: ${show(order)}`);
  assert.ok(order[0].chroma > order[1].chroma, `chroma falls down the list: ${show(order)}`);
});

test('contact sheet: every strip cell carries its chroma and saturated areas in design units', () => {
  // A saturated disc at a known design position on white.
  const size = validate(EXAMPLES.readout).size, disc = { x: 0.3 * size.w, y: 0.4 * size.h, r: 0.1 * size.w };
  const dims = {};
  const image = (w, h) => {
    const k = w / size.w, data = new Uint8ClampedArray(w * h * 4);
    dims.w = w; dims.h = h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.hypot((x + 0.5) / k - disc.x, (y + 0.5) / k - disc.y) < disc.r) data.set([30, 90, 220, 255], (y * w + x) * 4);
    }
    return data;
  };
  const { window } = runStrip({ frames: 3 }, {}, 'readout', [], 3, null, null, null, null, image);
  const k = dims.w / size.w, slack = (Math.max(1, Math.round(dims.w / 64)) + 1) / k;
  const direct = cellViews({ width: dims.w, height: dims.h, data: image(dims.w, dims.h) }, {});
  const cells = window.__sheet.cells;
  assert.equal(cells.length, 3);
  for (const [i, { chroma, saturated }] of cells.entries()) {
    assert.deepEqual({ ...chroma }, { ...direct.chroma }, `cell ${i} chroma is cellViews'`);
    const a = saturated[0];
    assert.ok(a.x <= disc.x && disc.x <= a.x + a.w && a.y <= disc.y && disc.y <= a.y + a.h, `cell ${i} area ${JSON.stringify(a)} holds the disc's centre`);
    const off = Math.max(Math.abs(a.x - (disc.x - disc.r)), Math.abs(a.y - (disc.y - disc.r)), Math.abs(a.x + a.w - (disc.x + disc.r)), Math.abs(a.y + a.h - (disc.y + disc.r)));
    assert.ok(off <= slack, `cell ${i} area edges lie ${off.toFixed(2)} design units from the disc's box, over ${slack.toFixed(2)}`);
  }
});

test('contact sheet: chroma.areas compares the rounded C the listed areas show', () => {
  // #000c40 has C just over 0.1, which rounds to 0.1: listed with chroma 0.1, so not counted as over 0.1.
  const deep = [0x00, 0x0c, 0x40, 255], C = oklch('#000c40')[1];
  assert.ok(C > 0.1 && +C.toFixed(4) === 0.1, `#000c40 is just over C 0.1: ${C}`);
  const v = cellViews(rgbaImage(64, 40, (x, y) => (x >= 10 && x < 14 && y >= 10 && y < 14 ? deep : [255, 255, 255, 255])), {});
  assert.equal(v.saturated[0].chroma, 0.1);
  assert.equal(v.chroma.areas, v.saturated.filter((a) => a.chroma > 0.1).length, 'areas counts what the list shows over 0.1');
});

test('contact sheet: --sample names design points on a time strip with --json, and is refused anywhere else', async (t) => {
  const args = parseArgs(['readout', '--at', '2', '--sample', '10,20', '--sample', '30.5,40', '--json']);
  assert.deepEqual(args.strip.samples, [{ x: 10, y: 20 }, { x: 30.5, y: 40 }]);
  assert.ok(!('samples' in parseArgs(['readout', '--at', '2']).strip), 'a strip without --sample keeps its shape');
  assert.equal(sheetStem(['readout'], [], null, null, args.strip), sheetStem(['readout'], [], null, null, parseArgs(['readout', '--at', '2']).strip), 'the file name stays the strip\'s');
  const refusals = [
    [['readout', '--at', '2', '--json', '--sample'], /--sample needs a design point as x,y, such as 480,300, got nothing/],
    [['readout', '--at', '2', '--json', '--sample', '1,2,3'], /--sample needs a design point as x,y, such as 480,300, got 1,2,3$/m],
    [['readout', '--at', '2', '--json', '--sample', '-1,2'], /--sample needs a design point as x,y, such as 480,300, got -1,2$/m],
    [['readout', '--at', '2', '--json', '--sample', '1,2', '--sample', '1,2'], /use --sample 1,2 only once/],
    [['drift', '--sample', '1,2', '--json'], /--sample reads the frames of a time strip; add --frames, --at, --shots or --contacts/],
    [['readout', '--at', '2', '--sample', '1,2'], /--sample reports in the sheet's JSON; add --json/],
  ];
  for (const [bad, message] of refusals) {
    await t.test(bad.join(' '), () => assert.throws(() => parseArgs(bad), (e) => message.test(e.message) && e.message.startsWith('seeds: ') && e.message.endsWith(USAGE)));
  }
});

test('contact sheet: planStrip refuses a --sample point outside the box and carries the rest into the layout', () => {
  const p = validate(EXAMPLES.readout), { w, h } = p.size;
  assert.throws(() => planStrip(p, { frames: 3, samples: [{ x: w + 1, y: 0 }] }), (e) => e.message.startsWith(`seeds: --sample ${w + 1},0 is outside readout's ${w} x ${h} box\n`));
  assert.deepEqual(planStrip(p, { frames: 3, samples: [{ x: w, y: h }] }).samples, [{ x: w, y: h }], 'the far edge is inside');
  assert.ok(!('samples' in planStrip(p, { frames: 3 })), 'a strip without samples has no samples key');
});

test('contact sheet: cellViews samples the mean OKLab within one pixel of each point, over white', () => {
  const [L, C, h] = oklch('#c8643c');
  const img = rgbaImage(12, 6, (x) => (x < 4 ? [0xc8, 0x64, 0x3c, 255] : x < 8 ? [0, 0, 0, 0] : [0, 0, 0, 128]));
  const [patch, clear, half, corner] = cellViews(img, { samples: [[1, 2], [5, 2], [10, 2], [0, 0]] }).samples;
  near(patch.L, L, 'L', 1e-4); near(patch.C, C, 'C', 1e-4); near(patch.h, (h * 180) / Math.PI, 'h in degrees', 0.1);
  near(Math.hypot(patch.a, patch.b), C, 'C is the length of a, b', 2e-4);
  assert.deepEqual(clear, { L: 1, a: 0, b: 0, C: 0, h: null }, 'a transparent pixel reads as the white under it');
  const grey = 255 - 128;
  near(half.L, lightnessOf(grey), 'half-transparent black reads as its blend over white', 1e-4);
  assert.equal(half.h, null, 'a neutral colour has no hue');
  assert.deepEqual(corner, patch, 'a corner averages only the pixels inside the image');
  assert.equal(cellViews(img, {}).samples, null, 'no samples asked, none given');
});

test('contact sheet: --sample gives every strip cell the colour at each design point', () => {
  const size = validate(EXAMPLES.readout).size, disc = { x: 0.3 * size.w, y: 0.4 * size.h, r: 0.1 * size.w };
  const dims = {};
  const image = (w, h) => {
    const k = w / size.w, data = new Uint8ClampedArray(w * h * 4);
    dims.w = w; dims.h = h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.hypot((x + 0.5) / k - disc.x, (y + 0.5) / k - disc.y) < disc.r) data.set([30, 90, 220, 255], (y * w + x) * 4);
    }
    return data;
  };
  const points = [{ x: disc.x, y: disc.y }, { x: 0.9 * size.w, y: 0.9 * size.h }];
  const { window } = runStrip({ frames: 3, samples: points }, {}, 'readout', [], 3, null, null, null, null, image);
  const k = dims.w / size.w;
  const direct = cellViews({ width: dims.w, height: dims.h, data: image(dims.w, dims.h) }, { samples: points.map((s) => [Math.floor(s.x * k), Math.floor(s.y * k)]) }).samples;
  const [L, C] = oklch('#1e5adc');
  near(direct[0].L, L, 'the disc point reads the disc', 1e-4); near(direct[0].C, C, 'its C', 1e-4);
  assert.deepEqual(direct[1], { L: 1, a: 0, b: 0, C: 0, h: null }, 'the ground point reads white');
  const cells = window.__sheet.cells;
  assert.equal(cells.length, 3);
  for (const [i, cell] of cells.entries()) {
    assert.deepEqual(JSON.parse(JSON.stringify(cell.samples)), points.map((s, j) => ({ x: s.x, y: s.y, ...direct[j] })), `cell ${i} samples`);
  }
});

test('contact sheet: cellViews measures the share of pixels more than 0.05 from both declared values, only when asked', () => {
  const d = lightnessOf(20), l = lightnessOf(230);
  // A 100 x 10 cell: half dark, then light, with a mid-grey stripe 10 pixels wide.
  const img = greyImage(100, 10, (x) => (x >= 90 ? 128 : x < 50 ? 20 : 230));
  near(cellViews(img, { twoValues: [d, l] }).between, 0.1, 'the mid-grey stripe is a tenth of the cell', 1e-4);
  near(cellViews(greyImage(100, 10, (x) => (x < 50 ? 20 : 230)), { twoValues: [d, l] }).between, 0, 'two values alone have none between', 1e-4);
  // Declared 0.04 under the dark grey and 0.06 over the light one: the dark half counts as on, the light half as between.
  near(cellViews(img, { twoValues: [d - 0.04, l + 0.06] }).between, 0.5, 'within 0.05 is on a value, past it is between', 1e-4);
  const g = 255 - 128;
  near(cellViews(greyImage(10, 10, () => 0, 128), { twoValues: [lightnessOf(g), 0.98] }).between, 0, 'half-transparent black is measured over white', 1e-4);
  assert.ok(!('between' in cellViews(img, {})), 'no declared values, no between key');
});

test('contact sheet: --two-values takes dark,light on a time strip and refuses anything else by name', async (t) => {
  const args = parseArgs(['readout', '--frames', '3', '--two-values', '0.12,0.88']);
  assert.deepEqual(args.strip.twoValues, [0.12, 0.88]);
  assert.ok(!('twoValues' in parseArgs(['readout', '--frames', '3']).strip), 'a strip without --two-values keeps its shape');
  assert.equal(sheetStem(['readout'], [], null, null, args.strip), sheetStem(['readout'], [], null, null, parseArgs(['readout', '--frames', '3']).strip), 'the file name stays the strip\'s');
  const malformed = (got) => new RegExp(`--two-values needs two OKLCh lightnesses, dark then light, from 0 to 1, such as 0\\.12,0\\.88, got ${got}$`, 'm');
  const unheld = (got) => new RegExp(`--two-values needs the dark value 0\\.2 or more under the light one, both from 0 to 1, as a declared two-value film holds them, got ${got}$`, 'm');
  const refusals = [
    [['readout', '--frames', '3', '--two-values'], malformed('nothing')],
    [['readout', '--frames', '3', '--two-values', '0.12'], malformed('0\\.12')],
    [['readout', '--frames', '3', '--two-values', '0.12,x'], malformed('0\\.12,x')],
    [['readout', '--frames', '3', '--two-values', '1e-1,0.9'], malformed('1e-1,0\\.9')],
    [['readout', '--frames', '3', '--two-values', '0.9,0.12'], unheld('0\\.9,0\\.12')],
    [['readout', '--frames', '3', '--two-values', '0.5,0.6'], unheld('0\\.5,0\\.6')],
    [['readout', '--frames', '3', '--two-values', '0.1,1.2'], unheld('0\\.1,1\\.2')],
    [['readout', '--frames', '3', '--two-values', '0.1,0.9', '--two-values', '0.1,0.9'], /use --two-values only once/],
    [['drift', '--two-values', '0.1,0.9'], /--two-values reads the frames of a time strip; add --frames, --at, --shots or --contacts/],
  ];
  for (const [bad, message] of refusals) {
    await t.test(bad.join(' '), () => assert.throws(() => parseArgs(bad), (e) => message.test(e.message) && e.message.startsWith('seeds: ') && e.message.endsWith(USAGE)));
  }
});

test('contact sheet: declaredValues reads `two values: <dark>, <light>` from a beat sheet', () => {
  assert.deepEqual(declaredValues('// Beat sheet\n// two values: 0.12, 0.88\nmodule.exports = {};', 'film.cjs'), [0.12, 0.88]);
  assert.equal(declaredValues('// Beat sheet\nmodule.exports = {};', 'film.cjs'), null, 'no line, no values');
  assert.equal(declaredValues('// two values: <dark L>, <light L>', 'film.cjs'), null, 'the placeholder declares nothing');
  assert.throws(() => declaredValues('// two values: 0.6, 0.5', 'film.cjs'), (e) => e.message.startsWith(
    'seeds: film.cjs declares two values: 0.6, 0.5 in its beat sheet; a declared two-value film\'s dark value lies 0.2 or more under its light one, both from 0 to 1\n'));
  assert.deepEqual(declaredValues('/* two values: 0.12, 0.88 */', 'film.cjs'), [0.12, 0.88], 'a closing comment is not part of the values');
  assert.deepEqual(declaredValues('// two values: <dark L>, <light L>\n// two values: 0.2, 0.9', 'film.cjs'), [0.2, 0.9], 'the placeholder line is passed over');
});

test('contact sheet: declaredValues reads a beat sheet saved with CRLF endings', () => {
  assert.deepEqual(declaredValues('// Beat sheet\r\n// two values: 0.12, 0.88\r\nmodule.exports = {};\r\n', 'film.cjs'), [0.12, 0.88]);
  assert.deepEqual(declaredValues('/**\r\n * Beat sheet\r\n * two values: 0.2, 0.9\r\n */\r\n', 'film.cjs'), [0.2, 0.9], 'a block comment line');
});

test('contact sheet: declaredValues reads only a comment line that opens with two values:', () => {
  assert.equal(declaredValues('// This film keeps to two values: ink and paper.\nmodule.exports = {};', 'film.cjs'), null, 'prose in a comment declares nothing');
  assert.equal(declaredValues("const note = 'two values: 0.12, 0.88';", 'film.cjs'), null, 'code declares nothing');
  assert.deepEqual(declaredValues(' * keeps to two values: ink and paper.\n * two values: 0.12, 0.88', 'film.cjs'), [0.12, 0.88], 'the declaring line counts after prose');
});

test('contact sheet: declaredValues warns of a line holding two values: and a number that is not a declaring comment line', () => {
  const notes = [];
  const text = '// Beat sheet\nconst ink = 1; // two values: 0.12, 0.88\n// - two values: 0.2, 0.9\n// keeps to two values: ink and paper.\nmodule.exports = {};';
  assert.equal(declaredValues(text, 'film.cjs', (m) => notes.push(m)), null, 'a near miss declares nothing');
  assert.deepEqual(notes, [
    'warning: film.cjs line 2 holds two values: 0.12, 0.88, but seeds reads two values only from a comment line that opens with them, such as // two values: 0.12, 0.88',
    'warning: film.cjs line 3 holds two values: 0.2, 0.9, but seeds reads two values only from a comment line that opens with them, such as // two values: 0.12, 0.88',
  ]);
  notes.length = 0;
  const typos = 'x(); // two values: .19, .92\ny(); // two values: 0.12 / 0.88\nz(); // two values: 0.12, 0.88e5 */';
  assert.equal(declaredValues(typos, 'film.cjs', (m) => notes.push(m)), null);
  assert.deepEqual(notes.map((m) => m.slice(0, m.indexOf(', but '))), [
    'warning: film.cjs line 1 holds two values: .19, .92',
    'warning: film.cjs line 2 holds two values: 0.12 / 0.88',
    'warning: film.cjs line 3 holds two values: 0.12, 0.88e5 */',
  ], 'a mistyped line after code is quoted as written');
  notes.length = 0;
  assert.deepEqual(declaredValues('/* two values: 0.12, 0.88 */\n * two values: <dark L>, <light L>', 'film.cjs', (m) => notes.push(m)), [0.12, 0.88]);
  assert.deepEqual(notes, [], 'the declaring line and a placeholder line get no note');
});

test('contact sheet: declaredValues warns of a worded value after code and keeps an ellipsis in prose silent', () => {
  const notes = [];
  const text = 'x(); // two values: dark 0.12, light 0.88\n// It keeps to two values: ... ink and paper.\nconst a = 1; // two values: ... ink and paper';
  assert.equal(declaredValues(text, 'film.cjs', (m) => notes.push(m)), null);
  assert.deepEqual(notes, [
    'warning: film.cjs line 1 holds two values: dark 0.12, light 0.88, but seeds reads two values only from a comment line that opens with them, such as // two values: 0.12, 0.88',
  ]);
});

test('contact sheet: declaredValues warns of each declaring line after the first, quoting it', () => {
  const notes = [];
  const text = '// two values: 0.12, 0.88\n  // two values: .2, .9\n/* two values: 0.2, 0.9 */\n * two values: ink and paper';
  assert.deepEqual(declaredValues(text, 'film.cjs', (m) => notes.push(m)), [0.12, 0.88]);
  assert.deepEqual(notes, [
    'warning: film.cjs line 2 holds // two values: .2, .9, but seeds reads two values only from the first comment line that declares them, line 1',
    'warning: film.cjs line 3 holds /* two values: 0.2, 0.9 */, but seeds reads two values only from the first comment line that declares them, line 1',
    'warning: film.cjs line 4 holds * two values: ink and paper, but seeds reads two values only from the first comment line that declares them, line 1',
  ]);
  notes.length = 0;
  assert.deepEqual(declaredValues('// two values: 0.12, 0.88\n// two values: ... ink and paper', 'film.cjs', (m) => notes.push(m)), [0.12, 0.88]);
  assert.deepEqual(notes, ['warning: film.cjs line 2 holds // two values: ... ink and paper, but seeds reads two values only from the first comment line that declares them, line 1'],
    'a digitless line after a real declaration warns');
});

test('contact sheet: declaredValues passes over only the <dark L> placeholder silently and warns of another value opening with <', () => {
  const notes = [];
  assert.deepEqual(declaredValues('// two values: <0.12>, 0.88\n// two values: <dark L>, <light L>\n// two values: 0.2, 0.9', 'film.cjs', (m) => notes.push(m)), [0.2, 0.9]);
  assert.deepEqual(notes, ['warning: film.cjs line 1 holds // two values: <0.12>, 0.88, but seeds reads a value that opens with < as declaring nothing; write two plain decimals, such as // two values: 0.12, 0.88']);
});

test('contact sheet: declaredValues reads the two values of tests/fixtures/two-value-film.cjs', () => {
  const fixture = loadExternal(path.join(__dirname, 'fixtures', 'two-value-film.cjs'));
  const notes = [];
  assert.deepEqual(declaredValues(fs.readFileSync(fixture.entry, 'utf8'), 'two-value-film.cjs', (m) => notes.push(m)), [0.19, 0.92]);
  assert.deepEqual(notes, []);
});

// One subtest per refusal, so each names its own line when it fails.
test('contact sheet: declaredValues refuses a beat-sheet line that is not two plain decimals by name', async (t) => {
  for (const [line, got] of [['two values: .12, .88', '.12, .88'], ['two values: 0.12 / 0.88', '0.12 / 0.88'], ['two values: 0.12, 0.88e5', '0.12, 0.88e5'], ['two values: .12, .88\n// two values: 0.12, 0.88', '.12, .88'], ['two values: 0.12 0.88\r\n// two values: 0.12, 0.88', '0.12 0.88'], ['two values: ... ink and paper', '... ink and paper']]) {
    await t.test(JSON.stringify(line), () => assert.throws(() => declaredValues(`// ${line}`, 'film.cjs'), (e) => e.message.startsWith(
      `seeds: film.cjs declares two values: ${got} in its beat sheet; a declared two-value film's line reads two values: <dark>, <light> in plain decimals, such as two values: 0.12, 0.88\n`)));
  }
});

test('contact sheet: stripFlags lists cells over STRIP_RULES.between only with two declared values', () => {
  const cells = [0.01, 0.1, null, 0.03].map((between, i) => ({ frame: i, seconds: i, t: i / 3, detail: 5, error: i === 2 ? 'boom' : null, between }));
  const lumas = cells.map(() => ({ w: 8, h: 8, block: 2, data: new Float64Array(64).fill(100) }));
  assert.deepEqual(stripFlags(cells, lumas, STRIP_RULES, 640, [0.2, 0.9]).between,
    [{ cell: 1, frame: 1, seconds: 1, t: 1 / 3, share: 0.1 }, { cell: 3, frame: 3, seconds: 3, t: 1, share: 0.03 }]);
  assert.deepEqual(stripFlags(cells, lumas, STRIP_RULES, 640).between, [], 'no declared values, an empty between list');
});

test('contact sheet: stripFlags leaves a cell with no luma out of the between list, as trustedCell does', () => {
  const cells = [0.1, 0.1].map((between, i) => ({ frame: i, seconds: i, t: i, detail: 5, error: null, between }));
  const lumas = [{ w: 8, h: 8, block: 2, data: new Float64Array(64).fill(100) }, null];
  assert.deepEqual(stripFlags(cells, lumas, STRIP_RULES, 640, [0.2, 0.9]).between.map((f) => f.cell), [0]);
});

test('contact sheet: a strip with two declared values reports each cell\'s share and flags cells over STRIP_RULES.between', () => {
  const d = lightnessOf(20), l = lightnessOf(230);
  // Every read-back: dark on the left, light on the right, and with `band` a mid-grey band over the last tenth.
  const painter = (band) => (w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = band && x >= Math.ceil(0.9 * w) ? 128 : x < w / 2 ? 20 : 230;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
    return data;
  };
  const run = (strip, band) => runStrip(strip, {}, 'readout', [], 3, null, null, null, null, painter(band));
  const banded = run({ frames: 3, twoValues: [d, l] }, true);
  // Through JSON, as the page's arrays come from another realm.
  const sheet = JSON.parse(JSON.stringify(banded.window.__sheet));
  assert.deepEqual(sheet.strip.twoValues, [d, l]);
  for (const cell of sheet.cells) assert.ok(Math.abs(cell.between - 0.1) < 0.01, `a banded cell reads about 0.1 between, got ${cell.between}`);
  assert.deepEqual(sheet.flags.between.map((f) => f.cell), [0, 1, 2]);
  assert.equal(banded.elements.filter((el) => el.className === 'flag' && /^tone between the two values: /.test(el.textContent)).length, 3, 'one flag under each cell');
  const clean = JSON.parse(JSON.stringify(run({ frames: 3, twoValues: [d, l] }, false).window.__sheet));
  assert.deepEqual(clean.cells.map((c) => c.between), [0, 0, 0]);
  assert.deepEqual(clean.flags.between, []);
  const plainRun = run({ frames: 3 }, true), plain = JSON.parse(JSON.stringify(plainRun.window.__sheet));
  assert.ok(plain.cells.every((c) => !('between' in c)), 'no declared values, no between');
  assert.deepEqual(plain.flags.between, [], 'no declared values, an empty between list');
  assert.ok(!plainRun.elements.some((el) => /two values/.test(el.textContent)), 'no declared values, no two-value report');
});

test('contact sheet: one bright highlight sets a cell\'s lightness max but not its 95th percentile', () => {
  // A 10 x 10 grey cell, a darker speck at (0, 0) and one white pixel at (9, 9).
  const spot = cellViews(greyImage(10, 10, (x, y) => (x === 9 && y === 9 ? 255 : x === 0 && y === 0 ? 20 : 100)), {}).lightness;
  near(spot.max, 1, 'max follows the highlight', 1e-4);
  near(spot.min, lightnessOf(20), 'min follows the speck', 1e-4);
  near(spot.p95, lightnessOf(100), 'the 95th percentile stays on the grey', 1e-4);
  near(spot.p5, lightnessOf(100), 'the 5th percentile stays on the grey', 1e-4);
  const split = cellViews(greyImage(200, 1, (x) => (x < 100 ? 0 : 255)), {}).lightness;
  assert.deepEqual([split.p5, split.p95], [0, 1], 'percentiles by nearest rank over two halves');
});

test('contact sheet: --light-page puts any sheet or strip on a light surround, and the dark page stays the default', () => {
  assert.equal(parseArgs(['readout', '--frames', '3', '--light-page']).lightPage, true);
  assert.equal(parseArgs(['drift', '--light-page']).lightPage, true, 'a seed sheet takes it');
  assert.equal('lightPage' in parseArgs(['readout', '--frames', '3']), false, 'without the flag a strip\'s arguments are unchanged');
  const ground = (html) => [...html.matchAll(/--bg:(#[0-9a-f]{6})/g)].map((m) => m[1]).pop();
  const lightness = (hex) => oklch(hex)[0];
  const dark = page(['readout'], 3, 1, [], null, null, { frames: 3 });
  const light = page(['readout'], 3, 1, [], null, null, { frames: 3 }, null, null, null, null, true);
  assert.ok(lightness(ground(dark)) < 0.3, `the default ground ${ground(dark)} is dark`);
  assert.ok(lightness(ground(light)) > 0.9, `the light-page ground ${ground(light)} is light`);
  assert.doesNotThrow(() => new vm.Script([...light.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]));
});

test('contact sheet: a page cell reports the value view\'s peak at its design-unit position with cellViews\' contrast', () => {
  // A dark disc at a known design position; the peak lies on its edge.
  const size = validate(EXAMPLES.readout).size, disc = { x: 0.4 * size.w, y: 0.5 * size.h, r: 0.2 * size.w };
  const dims = {};
  const image = (w, h) => {
    const k = w / size.w, data = new Uint8ClampedArray(w * h * 4);
    dims.w = w; dims.h = h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.hypot((x + 0.5) / k - disc.x, (y + 0.5) / k - disc.y) < disc.r) data[(y * w + x) * 4 + 3] = 255;
    }
    return data;
  };
  const views = { values: true, grey: false, colourVision: false };
  const { window } = runStrip({ frames: 3 }, {}, 'readout', [], 3, null, null, null, views, image);
  const k = dims.w / size.w, slack = Math.max(1, Math.round(0.02 * dims.w)) / k;
  assert.ok(k < 0.9, `the check needs a scale well below 1: ${k}`);
  const direct = cellViews({ width: dims.w, height: dims.h, data: image(dims.w, dims.h) }, views).peak;
  assert.ok(direct, 'the disc has a peak');
  const cells = window.__sheet.cells;
  assert.equal(cells.length, 3);
  for (const [i, { peak }] of cells.entries()) {
    assert.ok(peak, `cell ${i} has a peak`);
    assert.equal(peak.contrast, direct.contrast, `cell ${i} contrast`);
    const off = Math.abs(Math.hypot(peak.x - disc.x, peak.y - disc.y) - disc.r);
    assert.ok(off <= slack, `cell ${i} peak (${peak.x}, ${peak.y}) is ${off.toFixed(2)} design units from the disc edge, over ${slack.toFixed(2)}`);
    assert.ok(Math.abs(peak.x - (direct.x + 0.5) / k) < 0.01 && Math.abs(peak.y - (direct.y + 0.5) / k) < 0.01, `cell ${i} peak is cellViews' pixel in design units`);
  }
});

// A film of 20 frames at 10 Hz, 100 x 50, whose build keeps `views`, two shots, two beats and `extra` in s.cues: its file, and the validated piece.
const planFile = (t, views, name = 'plan-film', extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-plan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, `${name}.cjs`);
  const cues = { shots: [{ name: 'a', start: 0, end: 10 }, { name: 'b', start: 10, end: 20 }],
    beats: [{ frame: 2, intensity: 0.3, element: 'e', changes: 'a < b' }, { frame: 7, intensity: 1, element: 'e', changes: 'turns' }], views, ...extra };
  fs.writeFileSync(file, `module.exports = { name: '${name}', size: { w: 100, h: 50 }, seed: 1, time: { duration: 2, hz: 10 },`
    + ` build: [['plan', (s) => { s.cues = ${JSON.stringify(cues)}; }]], draw(g) { g.fillRect(0, 0, 100, 50); } };\n`);
  return file;
};
const planFilm = (t, views, name, extra) => validate(loadExternal(planFile(t, views, name, extra)).piece);
// Holds at (50, 25) on frames 0 to 4, pans 10 a frame to (100, 25) by frame 9, cuts to (0, 25) on frame 10 and holds.
const PAN = Array.from({ length: 20 }, (_, f) => (f < 5 ? { x: 50, y: 25, zoom: 1 } : f < 10 ? { x: 10 * f + 10, y: 25, zoom: 1 } : { x: 0, y: 25, zoom: 1, ...(f === 10 && { cut: true }) }));

test("contact sheet: --plan draws a film's view on every frame over the place, with its beats and each beat's speed against its move's peak", (t) => {
  const plan = viewPlan(planFilm(t, PAN));
  assert.deepEqual(plan.moves, [{ from: 4, to: 9, peak: 1 }], 'each step is 10/100 frame widths at 10 Hz; the cut at frame 10 is in no move');
  assert.deepEqual([plan.beats[0].speed, plan.beats[0].move, plan.beats[0].share], [0, null, null]);
  assert.deepEqual([plan.beats[1].speed, plan.beats[1].move, plan.beats[1].share], [1, 0, 1]);
  assert.equal(plan.peak, 1);
  assert.deepEqual(plan.box, { x0: -50, y0: 0, x1: 150, y1: 50 });
  assert.deepEqual(planText(plan), [
    'beat 1 at 0.20 s (e: a < b): at rest',
    'beat 2 at 0.70 s (e: turns): 1.00 frame widths/s, 100% of the peak of move 1',
    'move 1: frames 4 to 9 (0.40 to 0.90 s), peak 1.00 frame widths/s',
  ]);
  const html = planPage(plan);
  assert.match(html, /<svg[^>]+role="img"/);
  assert.equal(html.match(/<circle/g).length, 20 + 2, 'a dot per frame and a ring per beat');
  assert.match(html, /cut to b/);
  assert.match(html, /a &lt; b/);
  assert.doesNotMatch(html, /<script/);
  // A zoom at a fixed centre moves the corners, so it is a move too.
  const zoom = viewPlan(planFilm(t, Array.from({ length: 20 }, (_, f) => ({ x: 50, y: 25, zoom: f < 5 ? 1 : f < 10 ? 1 + (f - 4) / 5 : 2 })), 'zoom-film'));
  assert.deepEqual(zoom.moves.map((m) => [m.from, m.to]), [[4, 9]]);
  assert.ok(zoom.moves[0].peak > 0);
  assert.deepEqual(planText(viewPlan(planFilm(t, Array(20).fill({ x: 50, y: 25, zoom: 1 }), 'held-film'))).slice(-1), ['no move: the view holds']);
});

test('contact sheet: --plan counts a dolly as the subject plane scale, so a dolly-only push-in is a move and is boxed', (t) => {
  const dolly = Array.from({ length: 20 }, (_, f) => ({ x: 50, y: 25, zoom: 1, dolly: f < 5 ? 1 : f < 10 ? 1 + (f - 4) / 5 : 2 }));
  const plan = viewPlan(planFilm(t, dolly, 'dolly-film'));
  assert.deepEqual(plan.moves.map((m) => [m.from, m.to]), [[4, 9]]);
  assert.ok(plan.moves[0].peak > 0);
  assert.notEqual(planText(plan).slice(-1)[0], 'no move: the view holds');
  assert.equal(plan.views[19].zoom, 2, 'the view is the depth-1 scale, zoom * dolly');
  assert.match(planPage(plan), /<rect x="18.75" y="9.375" width="62.5" height="31.25"/, 'the beat on frame 7 is boxed at zoom * dolly 1.6');
  const same = viewPlan(planFilm(t, dolly.map((v) => ({ x: v.x, y: v.y, zoom: v.dolly })), 'zoom-same-film'));
  assert.deepEqual(plan.moves, same.moves, 'a dolly paces like the same zoom');
  const bad = dolly.map((v, f) => (f === 2 ? { ...v, dolly: 0 } : v));
  assert.match(((fn) => { try { fn(); } catch (e) { return e.message; } return 'no refusal'; })(() => viewPlan(planFilm(t, bad, 'bad-dolly-film'))), /entry \[2\] takes a dolly that is a finite number above 0 or no dolly, got dolly: 0/);
});

test('contact sheet: --plan refuses a still, a film with no view per frame and a view that is not finite, and takes one piece, --seed and --json', (t) => {
  const cause = (fn) => { try { fn(); } catch (e) { return e.message; } return 'no refusal'; };
  assert.equal(cause(() => viewPlan(validate(EXAMPLES.drift))), `seeds: --plan reads drift's view on every frame from state.cues.views, one { x, y, zoom } per frame, and drift keeps none there\n${USAGE}`);
  assert.equal(cause(() => viewPlan(validate(EXAMPLES.specimen))), `seeds: --plan draws a film's view across its frames, and specimen is a still\n${USAGE}`);
  assert.equal(cause(() => viewPlan(planFilm(t, PAN.slice(1), 'short-film'))), `seeds: --plan reads one view per frame from state.cues.views, and short-film keeps 19 for its 20 frames\n${USAGE}`);
  const bad = PAN.map((v, f) => (f === 3 ? { ...v, zoom: 0 } : v));
  assert.equal(cause(() => viewPlan(planFilm(t, bad, 'flat-film'))), `seeds: --plan: state.cues.views entry [3] is not { x, y, zoom } with finite numbers and a zoom above 0\n${USAGE}`);
  assert.equal(cause(() => viewPlan(planFilm(t, PAN.map((v, f) => (f === 4 ? { ...v, cut: false } : v)), 'uncut-film'))), `seeds: --plan: state.cues.views entry [4] takes cut: true or no cut, got cut: false\n${USAGE}`);
  assert.equal(cause(() => viewPlan(planFilm(t, PAN.map((v, f) => (f === 6 ? { ...v, key: 1 } : v)), 'one-key-film'))), `seeds: --plan: state.cues.views entry [6] takes key: true or no key, got key: 1\n${USAGE}`);
  assert.deepEqual(parseArgs(['x.cjs', '--plan']), { plan: true, names: ['x.cjs'], json: false });
  assert.deepEqual(parseArgs(['x.cjs', '--plan', '--seed', '7', '--json']), { plan: true, names: ['x.cjs'], json: true, seed: 7 });
  for (const [args, why] of [
    [['--plan'], 'name one piece for --plan'],
    [['a', 'b', '--plan'], '--plan takes one piece, got "a" and "b"'],
    [['a', '--plan', '--frames', '3'], '--plan takes one piece, --seed and --json, got --frames'],
    [['a', '--plan', '--png'], '--plan takes one piece, --seed and --json, got --png'],
    [['a', '--plan', '--plan'], 'use --plan only once'],
    [['a', '--plan', '--seed', 'x'], '--seed takes a whole number from 0 to 4294967295, got x'],
  ]) assert.equal(cause(() => parseArgs(args)), `seeds: ${why}\n${USAGE}`, args.join(' '));
});

// The film scaffold at 24 Hz with one element 'a' and `camera` and `beats` in its CAMERA and BEATS slots, and any other `slots` by name, as a validated piece.
const scaffoldFilm = (t, camera, beats, shots = "[['first', 4]]", slots = {}) => {
  let src = fs.readFileSync(path.join(__dirname, '..', 'skills', 'artifex', 'film-scaffold.cjs'), 'utf8');
  for (const [slot, value] of [['SHOTS', shots], ['ELEMENTS', "[{ name: 'a', enter: 0, exit: DUR }]"], ['CAMERA', camera], ['BEATS', beats], ...Object.entries(slots)]) {
    const re = new RegExp(`^const ${slot} = .*;$`, 'm');
    assert.match(src, re, `the scaffold lost its ${slot} slot`);
    src = src.replace(re, `const ${slot} = ${value};`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-plan-scaffold-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'film.cjs'), src);
  return validate(loadExternal('./film.cjs', dir).piece);
};

test("contact sheet: --plan reads the film scaffold's views, so a camera move runs key to key and a beat on its landing sits in its ease", (t) => {
  const plan = viewPlan(scaffoldFilm(t, '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 900, y: 300, zoom: 1.5 }]',
    "[{ at: 0.5, intensity: 0.3, element: 'a', changes: 'shown' }, { at: 2, intensity: 1, element: 'a', changes: 'lands' }]"));
  assert.deepEqual(plan.moves.map((m) => [m.from, m.to]), [[24, 48]], 'one move, from key to key');
  assert.equal(plan.beats[0].move, null);
  assert.equal(plan.beats[1].move, 0);
  assert.ok(plan.beats[1].share < 0.1, `the beat on the landing key is in the ease: ${plan.beats[1].share}`);
});

test('contact sheet: --plan splits chained scaffold camera keys into one move each, so a beat is measured against its own move', (t) => {
  // A short move to 700 then a long one to 1600: the beat midway through the short one is that move's peak, not a small share of the long one's.
  const chain = viewPlan(scaffoldFilm(t, '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 700, y: 360, zoom: 1 }, { at: 3, x: 1600, y: 360, zoom: 1 }]',
    "[{ at: 1.5, intensity: 0.5, element: 'a', changes: 'midway' }]"));
  assert.ok(chain.beats[0].share > 0.9, `the beat midway is near its own move's peak: ${chain.beats[0].share}`);
  assert.equal(chain.beats[0].move, 0);
  assert.deepEqual(chain.moves.map((m) => [m.from, m.to]), [[24, 48], [48, 72]], 'a move per pair of keys');
  // A beat on the key between a short move and a long one sits in both eases: the step in counts against the
  // move that ends there and the step out against the one that starts there, so neither divides by the wrong peak.
  const key = viewPlan(scaffoldFilm(t, '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 660, y: 360, zoom: 1 }, { at: 3, x: 5000, y: 360, zoom: 1 }]',
    "[{ at: 2, intensity: 1, element: 'a', changes: 'on the key' }]"));
  assert.deepEqual(key.moves.map((m) => [m.from, m.to]), [[24, 48], [48, 72]]);
  assert.ok(key.beats[0].move !== null && key.beats[0].share < 1 / 3, `the beat on the shared key is in the eases: ${key.beats[0].share} of move ${key.beats[0].move}`);
});

test('contact sheet: seeds --plan --seed --json writes <piece>-plan-seed<n>.html beside the piece, its lines to stderr and the plan to stdout', (t) => {
  const file = planFile(t, PAN, 'cli-film'), dir = path.dirname(file);
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'contact-sheet.js'), file, '--plan', '--seed', '3', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const written = path.join(dir, 'cli-film-plan-seed3.html');
  assert.ok(fs.existsSync(written), `wrote ${written}`);
  assert.match(fs.readFileSync(written, 'utf8'), /<svg[^>]+role="img"/);
  const plan = JSON.parse(run.stdout);
  assert.deepEqual([plan.seed, plan.views, plan.moves], [3, undefined, [{ from: 4, to: 9, peak: 1 }]]);
  assert.match(run.stderr, /cli-film-plan-seed3\.html {2}[\d.]+ kB/);
  assert.match(run.stderr, /^beat 2 at 0\.70 s \(e: turns\): 1\.00 frame widths\/s, 100% of the peak of move 1$/m);
  assert.match(run.stderr, /^move 1: frames 4 to 9 /m);
});

test('contact sheet: --plan lists an out-and-back on scaffold camera keys as two moves, and splits unmarked views where the step slows to a minimum', (t) => {
  // Out and back lists two moves, so the return shows in the plan's lines.
  const back = viewPlan(scaffoldFilm(t, '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 900, y: 360, zoom: 1 }, { at: 3, x: 640, y: 360, zoom: 1 }]', '[]'));
  assert.deepEqual(back.moves.map((m) => [m.from, m.to]), [[24, 48], [48, 72]]);
  // A film that marks no key splits where the step slows to a local minimum between two eases.
  const ease = (u) => (1 - Math.cos(Math.PI * u)) / 2;
  const views = Array.from({ length: 20 }, (_, f) => ({ x: f < 2 ? 0 : f < 10 ? 10 * ease((f - 2) / 8) : f < 18 ? 10 + 50 * ease((f - 10) / 8) : 60, y: 25, zoom: 1 }));
  assert.deepEqual(viewPlan(planFilm(t, views, 'eased-film')).moves.map((m) => [m.from, m.to]), [[2, 10], [10, 18]]);
  // A slowdown into a steady drift has no second speed-up, so it is one move, and a beat in the drift reads against its peak.
  const drift = [0, 30, 50, ...Array.from({ length: 17 }, (_, k) => 60 + 10 * k)].map((x) => ({ x, y: 25, zoom: 1 }));
  const slow = viewPlan(planFilm(t, drift, 'drift-film'));
  assert.deepEqual(slow.moves.map((m) => [m.from, m.to]), [[0, 19]]);
  assert.deepEqual([slow.beats[1].move, slow.beats[1].share], [0, 1 / 3]);
});

test('contact sheet: --plan keeps a camera move whole across a cut between shots, and still ends a move on a cut of the framing', (t) => {
  // Keys at 1 s and 3 s with a shot cut at 2 s: one move whose peak counts the step across the cut, and a beat at 1.8 s reads against it.
  const plan = viewPlan(scaffoldFilm(t, '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 3, x: 1600, y: 360, zoom: 1 }]',
    "[{ at: 1.8, intensity: 1, element: 'a', changes: 'midway' }]", "[['first', 2], ['second', 2]]"));
  assert.equal(plan.views[48].cut, undefined, 'a shot cut is no cut of the framing');
  assert.deepEqual(plan.moves.map((m) => [m.from, m.to]), [[24, 72]], 'one move, from key to key across the shot cut');
  const fastest = Math.max(...plan.views.slice(1).map((v, f) => Math.abs(v.x - plan.views[f].x))) * plan.hz / plan.size.w;
  assert.ok(Math.abs(plan.moves[0].peak - fastest) < 1e-9, `the peak ${plan.moves[0].peak} is the fastest step, ${fastest}`);
  assert.deepEqual([plan.beats[0].move, plan.beats[0].share === plan.beats[0].speed / fastest], [0, true]);
  // A fast pan and a fast zoom, each one second from key to key with the shot cut at its middle, stay whole too.
  for (const camera of ['[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 1600, y: 360, zoom: 1 }]', '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 640, y: 360, zoom: 2 }]']) {
    const fast = viewPlan(scaffoldFilm(t, camera, '[]', "[['first', 1.5], ['second', 1.5]]"));
    assert.deepEqual(fast.moves.map((m) => [m.from, m.to]), [[24, 48]], `one move across the shot cut for ${camera}`);
  }
  // An even pan of 5 a frame: a frame marked cut: true ends the move, whether the framing jumps there or the path runs on; unmarked, the move is whole.
  const pan = (jump, cut = true) => Array.from({ length: 20 }, (_, f) => ({ x: 5 * f + (f >= 10 ? jump : 0), y: 25, zoom: 1, ...(cut && f === 10 && { cut: true }) }));
  assert.deepEqual(viewPlan(planFilm(t, pan(0, false), 'whole-film')).moves.map((m) => [m.from, m.to]), [[0, 19]]);
  assert.deepEqual(viewPlan(planFilm(t, pan(0), 'kept-film')).moves.map((m) => [m.from, m.to]), [[0, 9], [10, 19]]);
  const jumped = viewPlan(planFilm(t, pan(200), 'jump-film'));
  assert.deepEqual(jumped.moves.map((m) => [m.from, m.to]), [[0, 9], [10, 19]]);
  assert.ok(jumped.moves.every((m) => Math.abs(m.peak - 5 * jumped.hz / jumped.size.w) < 1e-9), 'the jump of 200 counts in neither move');
  // The scaffold cuts the framing with two CAMERA keys on one second: the moves split there, and the jump from 900 to 2000 is in no peak.
  const framing = viewPlan(scaffoldFilm(t, '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 900, y: 360, zoom: 1 }, { at: 2, x: 2000, y: 360, zoom: 1 }, { at: 3, x: 2200, y: 360, zoom: 1 }]', '[]'));
  assert.equal(framing.views[48].cut, true);
  assert.deepEqual(framing.moves.map((m) => [m.from, m.to]), [[24, 47], [48, 72]]);
  const widest = (a, b) => Math.max(...framing.views.slice(a + 1, b + 1).map((v, k) => Math.abs(v.x - framing.views[a + k].x))) * framing.hz / framing.size.w;
  assert.ok(Math.abs(framing.moves[1].peak - widest(48, 72)) < 1e-9 && framing.moves[1].peak < 1, `the move after the cut peaks at its own fastest step, ${framing.moves[1].peak}`);
});

test("contact sheet: --plan draws each shot's subject marks and line of attention, and flags a view on the wrong side unless the crossing is named", (t) => {
  const rows = (b) => ({ blocking: [{ shot: 'a', marks: { p: [20, 25], q: [80, 25] }, line: ['p', 'q'] }, { shot: 'b', line: ['p', 'q'], ...b }] });
  const plan = viewPlan(planFilm(t, PAN, 'line-film', rows({ marks: { p: [80, 25], q: [20, 25] } })));
  assert.deepEqual(plan.blocking.map((r) => [r.shot, r.left, r.wrong]), [['a', 'p', false], ['b', 'q', true]]);
  assert.equal(plan.blocking[1].after, 'a');
  assert.ok(planText(plan).includes('shot b: q on the left of the line p to q, on the wrong side of the line after a: name the crossing with cross: true, or put p back on the left'), planText(plan).join('\n'));
  const html = planPage(plan);
  assert.match(html, /<line [^>]*stroke="#e8705a"/, 'the wrong-side line is red');
  assert.match(html, />p \(a\), q \(b\)</, 'swapped marks on one point share one label');
  assert.match(html, />q \(a\), p \(b\)</);
  assert.equal(html.match(/<text [^>]*>[pq] \(/g).length, 2, 'two mark points, one label each');
  assert.equal(html.match(/<circle/g).length, 20 + 2, 'marks are squares, not dots or rings');
  const named = viewPlan(planFilm(t, PAN, 'cross-film', rows({ marks: { p: [80, 25], q: [20, 25] }, cross: true })));
  assert.equal(named.blocking[1].wrong, false);
  assert.ok(planText(named).includes('shot b: q on the left of the line p to q, a named crossing'));
  const head = viewPlan(planFilm(t, PAN, 'head-on-film', rows({ marks: { p: [50, 25], q: [52, 25] } })));
  assert.deepEqual([head.blocking[1].left, head.blocking[1].wrong], [null, false]);
  assert.ok(planText(head).includes('shot b: head-on to the line p to q'));
  assert.deepEqual(viewPlan(planFilm(t, PAN, 'bad-line-film', rows({ marks: { p: [80, 25], q: [20, 25] }, line: ['p', 'z'] }))).blocking, [], 'a malformed blocking is left out, not refused');
});

test('contact sheet: --plan keeps every blocking mark inside the box and says when it leaves hand-built rows out', (t) => {
  const row = (extra) => ({ blocking: [{ shot: 'a', marks: { p: [300, -40], q: [-90, 25] }, line: ['p', 'q'], ...extra }] });
  const plan = viewPlan(planFilm(t, PAN, 'far-marks-film', row({})));
  assert.deepEqual(plan.box, { x0: -90, y0: -40, x1: 300, y1: 50 }, 'marks outside the views and the design box widen the box');
  assert.equal(plan.blockingLeftOut, null);
  const bad = viewPlan(planFilm(t, PAN, 'left-out-film', { blocking: [row({}).blocking[0], { shot: 'b', marks: { p: [1, 2] }, line: ['p', 'z'] }] }));
  assert.deepEqual([bad.blocking, bad.box], [[], { x0: -50, y0: 0, x1: 150, y1: 50 }], 'no row is drawn and no mark widens the box');
  assert.ok(planText(bad).includes('state.cues.blocking left out (row 2 of 2): every row needs its own shot of the film, marks as { name: [x, y] } with finite numbers, and a line of two different names of its marks'), planText(bad).join('\n'));
  const twice = viewPlan(planFilm(t, PAN, 'twice-film', { blocking: [row({}).blocking[0], row({}).blocking[0]] }));
  assert.deepEqual([twice.blocking.length, twice.blockingLeftOut], [0, 'row 2 of 2'], 'a shot named by two rows leaves both out');
  assert.ok(!planText(plan).some((l) => l.includes('left out')), 'usable rows print no such line');
  assert.ok(!planText(viewPlan(planFilm(t, PAN, 'no-rows-film'))).some((l) => l.includes('left out')), 'no rows print no such line');
});

test("contact sheet: --plan reads the film scaffold's BLOCKING and flags a shot on the wrong side of the line", (t) => {
  const blocking = (cross) => `[{ shot: 'first', marks: { a: [400, 500], b: [900, 500] }, line: ['a', 'b'] }, { shot: 'second', marks: { a: [900, 500], b: [400, 500] }, line: ['a', 'b']${cross} }]`;
  const plan = viewPlan(scaffoldFilm(t, '[]', '[]', "[['first', 2], ['second', 2]]", { BLOCKING: blocking('') }));
  assert.deepEqual([plan.blocking[1].wrong, plan.blocking[1].frame, plan.blocking[1].after], [true, 48, 'first']);
  assert.equal(viewPlan(scaffoldFilm(t, '[]', '[]', "[['first', 2], ['second', 2]]", { BLOCKING: blocking(', cross: true') })).blocking[1].wrong, false);
});

// A film of 30 frames at 10 Hz, 100 x 50, in three shots a, b and c of 10 frames, whose build keeps them in
// s.cues with `views` and `focus` (each left out when null), and which paints a dark disc on a light ground.
const CUT_SHOTS = [{ name: 'a', start: 0, end: 10 }, { name: 'b', start: 10, end: 20 }, { name: 'c', start: 20, end: 30 }];
// Holds at (50, 25), pans 1 a frame through shot b, holds at (59, 25) through shot c.
const CUT_PAN = Array.from({ length: 30 }, (_, f) => ({ x: f < 10 ? 50 : f < 20 ? 50 + (f - 10) : 59, y: 25, zoom: 1 }));
const CUT_FOCUS = [{ shot: 'a', in: [20, 25], out: [30, 25] }, { shot: 'b', in: [35, 25], out: [70, 25], jolt: true }, { shot: 'c', out: [80, 25], carry: 'in' }];
const cutFile = (t, { focus = CUT_FOCUS, views = CUT_PAN, shots = CUT_SHOTS } = {}, name = 'cut-film') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-cuts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, `${name}.cjs`);
  fs.writeFileSync(file, `module.exports = { name: '${name}', size: { w: 100, h: 50 }, seed: 1, time: { duration: 3, hz: 10 },`
    + ` build: [['cuts', (s) => { s.cues = ${JSON.stringify({ shots, ...(views !== null && { views }), ...(focus !== null && { focus }) })}; }]],`
    + ' draw(g) { g.fillStyle = "#eee"; g.fillRect(0, 0, 100, 50); g.fillStyle = "#222"; g.beginPath(); g.arc(30, 25, 10, 0, 2 * Math.PI); g.fill(); } };\n');
  return file;
};
const cutFilm = (t, opts, name) => validate(loadExternal(cutFile(t, opts, name)).piece);

test('contact sheet: --cuts needs --shots, keeps its own file, and leaves a plain --shots parse unchanged', () => {
  assert.equal(parseArgs(['x.cjs', '--shots', '--cuts']).strip.cuts, true);
  assert.equal('cuts' in parseArgs(['x.cjs', '--shots']).strip, false, 'a plain shot strip has no cuts key');
  const cause = (fn) => { try { fn(); } catch (e) { return e.message; } return 'no refusal'; };
  for (const args of [['x.cjs', '--frames', '3', '--cuts'], ['x.cjs', '--cuts']]) {
    assert.equal(cause(() => parseArgs(args)), `seeds: --cuts blends the frames either side of each cut on a shot strip; add --shots\n${USAGE}`, args.join(' '));
  }
  assert.equal(path.basename(sheetStem(['cues'], [], null, null, { shots: true, cuts: true })), 'cues-shots-cuts');
  assert.match(USAGE, /--shots \[--cuts\]/);
});

test('contact sheet: cutPlan carries each focus row through the views into each cut\'s jump and each shot\'s eye track', (t) => {
  const plan = cutPlan(cutFilm(t), CUT_SHOTS);
  assert.equal(plan.focus, true);
  assert.deepEqual(plan.cuts, [
    // Frame 9 views (50, 25), frame 10 too: out (30, 25), in (35, 25), 5 apart in a frame 100 wide.
    { cut: 1, from: 'a', to: 'b', frame: 10, out: [30, 25], in: [35, 25], jump: 0.05, jolt: true, carried: false },
    // Frame 19 views (59, 25), so b's out (70, 25) is at 61 on screen; c carries in, so the cut goes unchecked.
    { cut: 2, from: 'b', to: 'c', frame: 20, out: [61, 25], in: null, jump: null, jolt: false, carried: true },
  ]);
  assert.deepEqual(plan.tracks.map((tr) => [tr.shot, tr.points.length, tr.points[0], tr.points[tr.points.length - 1]]), [
    ['a', 10, [20, 25], [30, 25]], ['b', 10, [35, 25], [61, 25]], ['c', 10, [71, 25], [71, 25]]], 'c keeps only its out, seen from (59, 25)');
  // Without a view per frame, the design box.
  assert.deepEqual(cutPlan(cutFilm(t, { views: null }, 'boxed-film'), CUT_SHOTS).cuts[1].out, [70, 25]);
  const none = cutPlan(cutFilm(t, { focus: null }, 'plain-film'), CUT_SHOTS);
  assert.deepEqual([none.focus, none.tracks, none.cuts.map((c) => c.jump)], [false, [], [null, null]]);
});

test('contact sheet: cutPlan carries focus points through zoom * dolly, and refuses a dolly --plan refuses', (t) => {
  // The views differ across the cut at frame 10 only in dolly: the depth-1 plane scales 1 to 2 about (50, 25).
  const views = Array.from({ length: 30 }, (_, f) => ({ x: 50, y: 25, zoom: 1, ...(f >= 10 && { dolly: 2 }) }));
  const focus = [{ shot: 'a', in: [20, 25], out: [30, 25] }, { shot: 'b', in: [30, 25], out: [30, 25] }];
  const plan = cutPlan(cutFilm(t, { views, focus }, 'dolly-cut-film'), CUT_SHOTS);
  // Out on frame 9 at zoom 1: 30; in on frame 10 at zoom * dolly 2: 50 + 2 * (30 - 50) = 10; 20 apart in 100.
  assert.deepEqual([plan.cuts[0].out, plan.cuts[0].in, plan.cuts[0].jump], [[30, 25], [10, 25], 0.2]);
  const cause = (fn) => { try { fn(); } catch (e) { return e.message; } return 'no refusal'; };
  for (const dolly of [0, -1, null, 'x', Infinity]) {
    const bad = views.map((v, f) => (f === 2 ? { ...v, dolly } : v));
    assert.match(cause(() => cutPlan(cutFilm(t, { views: bad, focus }, 'bad-dolly-cut-film'), CUT_SHOTS)), /--cuts: state\.cues\.views entry \[2\] takes a dolly that is a finite number above 0 or no dolly, got dolly: /, String(dolly));
  }
  // Without focus rows the views are never read, so a bad dolly refuses nothing.
  const bad = views.map((v, f) => (f === 2 ? { ...v, dolly: 0 } : v));
  assert.equal(cutPlan(cutFilm(t, { views: bad, focus: null }, 'no-focus-bad-dolly-film'), CUT_SHOTS).focus, false);
});

test('contact sheet: cutPlan refuses a malformed focus row by index, and --cuts refuses a film of one shot', (t) => {
  const cause = (fn) => { try { fn(); } catch (e) { return e.message; } return 'no refusal'; };
  for (const [focus, why, name] of [
    [{ shot: 'a' }, 'state.cues.focus is not a list of { shot, in, out } rows', 'object-film'],
    [[{ in: [1, 1], out: [1, 1] }], 'state.cues.focus entry [0] names no shot of no-shot-film', 'no-shot-film'],
    [[CUT_FOCUS[0], { shot: 'z', in: [1, 1], out: [1, 1] }], 'state.cues.focus entry [1] names no shot of unknown-film', 'unknown-film'],
    [[CUT_FOCUS[0], CUT_FOCUS[0]], 'state.cues.focus entry [1] is a second row for shot a', 'twice-film'],
    [[{ shot: 'b', in: 'here' }], 'state.cues.focus entry [0] has neither an in nor an out [x, y]', 'pointless-film'],
    // As the film scaffold: only a carry drops a point, and it drops the one its cut would use.
    [[{ shot: 'b', out: [70, 25] }], 'state.cues.focus entry [0] has no in [x, y]; a row without a carry needs an in and an out', 'no-in-film'],
    [[CUT_FOCUS[0], { shot: 'b', in: [35, 25] }], 'state.cues.focus entry [1] has no out [x, y]; a row without a carry needs an in and an out', 'no-out-film'],
    [[{ shot: 'b', in: [35, 25], carry: 'in' }], 'state.cues.focus entry [0] has no out [x, y]; a row that carries in keeps its out', 'carry-in-film'],
    [[{ shot: 'b', out: [70, 25], carry: 'out' }], 'state.cues.focus entry [0] has no in [x, y]; a row that carries out keeps its in', 'carry-out-film'],
  ]) assert.equal(cause(() => cutPlan(cutFilm(t, { focus }, name), CUT_SHOTS)), `seeds: --cuts: ${why}\n${USAGE}`, name);
  const one = cutFilm(t, { shots: [{ name: 'only', start: 0, end: 30 }], focus: [] }, 'one-film');
  assert.equal(cause(() => planStrip(one, { shots: true, cuts: true })), `seeds: --cuts blends the frames either side of each cut, and one-film has one shot\n${USAGE}`);
});

test('contact sheet: cutPlan refuses the carry rows the film scaffold refuses, in its words', async (t) => {
  const cause = (fn) => { try { fn(); } catch (e) { return e.message; } return 'no refusal'; };
  const refuses = (focus, why, name) => assert.equal(cause(() => cutPlan(cutFilm(t, { focus }, name), CUT_SHOTS)), `seeds: --cuts: ${why}\n${USAGE}`);
  await t.test('a carry other than in or out', () => refuses([CUT_FOCUS[0], { shot: 'b', in: [35, 25], out: [70, 25], carry: 'both' }],
    "state.cues.focus entry [1]: the focus for b carries both: carry 'in' or 'out'", 'carry-both-film'));
  await t.test('a carry with a jolt', () => refuses([{ shot: 'b', out: [70, 25], carry: 'in', jolt: true }],
    'state.cues.focus entry [0]: the focus for b is a jolt and carries in: both are about the cut into b, and a carry leaves it unchecked, so keep one of them', 'carry-jolt-film'));
  await t.test("carry 'in' on the first shot", () => refuses([{ shot: 'a', out: [30, 25], carry: 'in' }],
    'state.cues.focus entry [0]: the focus for a carries in, but a is the first shot and has no cut into it: drop the carry', 'first-in-film'));
  await t.test("carry 'out' on the last shot", () => refuses([CUT_FOCUS[0], { shot: 'c', in: [42, 25], carry: 'out' }],
    'state.cues.focus entry [1]: the focus for c carries out, but c is the last shot and has no cut out of it: drop the carry', 'last-out-film'));
});

test('contact sheet: --plan builds the piece once per seed', (t) => {
  const base = planFilm(t, PAN, 'once-film');
  let builds = 0;
  const plan = viewPlan({ ...base, build: [...base.build, ['count', () => { builds++; }]] }, 3);
  assert.deepEqual([builds, plan.shots.length], [1, 2]);
});

test('contact sheet: cutOverlay draws each eye track and each unchecked jump on one frame, with no script', (t) => {
  const layout = planStrip(cutFilm(t), { shots: true, cuts: true });
  const svg = cutOverlay(layout);
  assert.match(svg, /<svg[^>]+role="img"/);
  assert.equal(svg.match(/<polyline/g).length, 3, 'one track per shot with a row');
  assert.equal(svg.match(/<line class="jump/g).length, 1, 'the carried cut draws no jump');
  assert.doesNotMatch(svg, /class="jump long"/, 'a short jump is not amber');
  assert.doesNotMatch(svg, /<script/);
  const long = { ...layout.cuts, tracks: [{ shot: 'a<b', points: [[0, 0]] }], cuts: [{ cut: 1, out: [0, 25], in: [50, 25], jump: 0.5, jolt: false }, { cut: 2, out: [0, 25], in: [50, 25], jump: 0.5, jolt: true }] };
  const marked = cutOverlay({ cuts: long });
  assert.equal(marked.match(/class="jump long"/g).length, 1, 'a jump over a third is amber unless it is a jolt');
  assert.match(marked, /a&lt;b/);
  assert.equal(cutOverlay({ cuts: { ...layout.cuts, focus: false } }), '', 'no focus rows, no overlay');
});

test('contact sheet: strayEdge finds a strong outgoing edge in the ring around the incoming focus, outside the outgoing one, and massShare reads the side of the mass', () => {
  const edge = frameDetail(greyImage(640, 320, (x) => (x < 320 ? 0 : 255)));
  const hit = strayEdge(edge, [330, 160], null, 40);
  assert.ok(hit.step >= CUT_RULES.edge && Math.abs(hit.x - 316) < 9, `the edge at 320 is found: ${JSON.stringify(hit)}`);
  assert.ok(strayEdge(edge, [500, 160], null, 40).step < CUT_RULES.edge, 'an edge outside the ring does not count');
  assert.ok(strayEdge(edge, [330, 160], [320, 160], 40).step < CUT_RULES.edge, 'blocks around the outgoing focus do not count');
  assert.equal(strayEdge(edge, [330, 160], [330, 160], 40), null, 'a ring inside the outgoing one holds no block');
  assert.equal(strayEdge(frameDetail(greyImage(640, 320, () => 128)), [320, 160], null, 40).step, 0, 'a flat frame has no edge');
  const block = (left) => frameDetail(greyImage(640, 320, (x, y) => ((left ? x < 200 : x >= 440) && y > 80 && y < 240 ? 20 : 230)));
  assert.ok(massShare(block(true)) > 0.55);
  assert.ok(massShare(block(false)) < 0.45);
  assert.equal(massShare(frameDetail(greyImage(160, 80, () => 90))), null);
});

test('contact sheet: a --shots --cuts page blends each cut\'s last frame under the next first frame and reports each cut in window.__sheet.cuts', (t) => {
  const external = loadExternal(cutFile(t));
  // Every read is a dark left third on white.
  const paint = (w, h) => { const d = new Uint8ClampedArray(w * h * 4).fill(255); for (let i = 0; i < w * h; i++) if (i % w < w / 3) d.fill(20, 4 * i, 4 * i + 3); return d; };
  const { window, draws, elements } = runStrip({ shots: true, cuts: true }, {}, 'cut-film', [], 0, external, null, null, null, paint);
  // Made in the page's realm, so compared as JSON.
  const cuts = JSON.parse(JSON.stringify(window.__sheet.cuts));
  assert.deepEqual(cuts.map((c) => [c.cut, c.from, c.to, c.jump, c.flipped]), [[1, 'a', 'b', 0.05, false], [2, 'b', 'c', null, false]]);
  assert.ok(cuts.every((c) => c.mass.out > 0.55 && c.mass.in > 0.55), JSON.stringify(cuts.map((c) => c.mass)));
  assert.ok(cuts[0].stray && cuts[1].stray === null, 'a cut with no incoming point rings nothing');
  const blends = draws.filter((d) => d.args.length === 3);
  assert.equal(blends.length, 4, 'two draws per cut');
  const source = page(['cut-film'], 0, 1, [], external, null, { shots: true, cuts: true });
  assert.ok(/x\.frame === cell\.frame/.test(source) && /x\.frame === c\.frame/.test(source) && !/x\.to === cell\.shot/.test(source),
    'each cut finds its blend and its pair by its frame, not by a shot name');
  const figures = elements.filter((el) => el.tag === 'figure');
  for (let k = 0; k < 4; k += 2) {
    const fig = figures.find((f) => f.children.includes(blends[k].canvas)), i = figures.indexOf(fig);
    assert.equal(blends[k + 1].canvas, blends[k].canvas);
    assert.equal(blends[k].args[0], figures[i - 1].children[0], 'first the outgoing shot\'s last frame');
    assert.equal(blends[k + 1].args[0], fig.children[0], 'then this first frame over it');
  }
  assert.match(page(['cut-film'], 0, 1, [], external, null, { shots: true, cuts: true }), /bg\.globalAlpha = 0\.5;\s*bg\.drawImage\(c, 0, 0\)/);
  // b carries out onto c, whose in point sits on the painted edge: the carrying shape is not a stray.
  const carryFocus = [CUT_FOCUS[0], { shot: 'b', in: [35, 25], carry: 'out' }, { shot: 'c', in: [42, 25], out: [80, 25] }];
  const carry = runStrip({ shots: true, cuts: true }, {}, 'carry-film', [], 0, loadExternal(cutFile(t, { focus: carryFocus }, 'carry-film')), null, null, null, paint);
  const carried = JSON.parse(JSON.stringify(carry.window.__sheet.cuts))[1];
  assert.deepEqual([carried.stray, carried.strong], [null, false], JSON.stringify(carried));
  const plain = runStrip({ shots: true }, {}, 'cut-film', [], 0, external, null, null, null, paint);
  assert.equal('cuts' in plain.window.__sheet, false);
  assert.equal(plain.draws.filter((d) => d.args.length === 3).length, 0, 'a plain shot strip blends nothing');
});

test('contact sheet: a --shots --cuts page flags a stray outgoing edge on the incoming focus and a flip of the mass, and leaves a carried cut unflagged', (t) => {
  // The cells are a first, middle and last frame per shot. Each first frame is dark on its right 40%, every other
  // frame dark on its left 40%: the outgoing frame's edge at 40 of 100 lies in the ring around b's in (35, 25),
  // beyond the ring around a's out (30, 25), and the mass changes sides across each cut.
  const seen = [];
  const paint = (w, h, canvas) => {
    if (w < 2) return new Uint8ClampedArray(w * h * 4);
    if (!seen.includes(canvas)) seen.push(canvas);
    const first = seen.indexOf(canvas) % 3 === 0, d = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let i = 0; i < w * h; i++) if (first ? i % w >= 0.6 * w : i % w < 0.4 * w) d.fill(20, 4 * i, 4 * i + 3);
    return d;
  };
  const { window, elements } = runStrip({ shots: true, cuts: true }, {}, 'cut-film', [], 0, loadExternal(cutFile(t)), null, null, null, paint);
  assert.equal(seen.length, 9, 'one painted read per cell');
  const cuts = JSON.parse(JSON.stringify(window.__sheet.cuts));
  assert.deepEqual(cuts.map((c) => [c.cut, c.flipped]), [[1, true], [2, true]]);
  assert.equal(cuts[0].strong, true, JSON.stringify(cuts[0]));
  assert.ok(cuts[0].stray.step >= CUT_RULES.edge && Math.abs(cuts[0].stray.x - 40) < 6, JSON.stringify(cuts[0].stray));
  assert.deepEqual([cuts[1].stray, cuts[1].strong], [null, false], 'c carries in: its cut is unchecked');
  const flags = elements.filter((el) => el.className === 'flag').map((el) => el.textContent);
  assert.deepEqual(flags, [`stray: an outgoing edge of ${cuts[0].stray.step} lies on the incoming focus`]);
});

test('contact sheet: --motion measures every frame against the one before and reports still stretches and jumps that are no cut', () => {
  const { motionSummary, MOTION } = require('../tools/contact-sheet.js');
  // 96 frames at 24 a second: steady motion, a jump at 30, a cut at 48, then still from 60.
  const changes = Array.from({ length: 96 }, (_, f) => (f === 0 || f >= 60 ? 0 : f === 30 ? 9 : f === 48 ? 40 : 1 + 0.2 * (f % 3)));
  const sum = motionSummary(changes, 24, [48], MOTION);
  assert.equal(sum.step, 1);
  assert.ok(sum.median >= 1 && sum.median <= 1.4, 'the median of the drawings, ' + sum.median);
  assert.deepEqual(sum.jumps.map((j) => j.frame), [30], 'the cut at 48 is no jump');
  assert.equal(sum.jumps[0].seconds, 1.25);
  assert.ok(Math.abs(sum.jumps[0].times - 9 / sum.median) < 0.06);
  assert.deepEqual(sum.still, [{ from: 2.5, to: 4 }], 'still from frame 60 to the end');
  assert.equal(sum.energy.length, 96);
  // On twos every other frame repeats: the trace holds each change over its repeat, so nothing reads as still.
  const twos = Array.from({ length: 96 }, (_, f) => (f && f % 2 === 0 ? 1.5 : 0));
  const held = motionSummary(twos, 24, [], MOTION);
  assert.equal(held.step, 2);
  assert.deepEqual(held.still, []);
  assert.ok(held.energy.slice(2).every((v) => v === 1.5));
  // A stretch under a second is not reported, and a film that never moves is one stretch.
  const brief = motionSummary(Array.from({ length: 96 }, (_, f) => (f && (f < 40 || f >= 60) ? 1 : 0)), 24, [], MOTION);
  assert.deepEqual(brief.still, []);
  const frozen = motionSummary(new Array(48).fill(0), 24, [], MOTION);
  assert.deepEqual([frozen.median, frozen.jumps, frozen.still], [0, [], [{ from: 0.042, to: 2 }]]);

  const args = parseArgs(['readout', '--frames', '9', '--motion', '--png']);
  assert.equal(args.strip.motion, true);
  assert.equal(sheetStem(['readout'], [], null, null, args.strip), path.join(__dirname, '..', 'out', 'readout-frames-motion'));
  const p = validate(EXAMPLES.readout), strip = planStrip(p, args.strip);
  assert.equal(strip.motion.heads.length, 168, 'every frame is drawn');
  assert.deepEqual([strip.motion.w, strip.motion.h], [160, 107]);
  assert.deepEqual(strip.motion.cuts, solve(p, p.seed).state.cues.shots.slice(1).map((s) => s.start), 'a shot start is a cut');
  assert.equal(planStrip(p, { frames: 9 }).motion, undefined);
  assert.throws(() => parseArgs(['readout', '--motion']), /--motion belongs to a time strip/);
  assert.doesNotMatch(page(['readout'], 3, 1, [], null, null, { frames: 3 }), /motionSummary/, 'the plain strip page is unchanged');
  assert.match(page(['readout'], 3, 1, [], null, null, { frames: 3, motion: true }), /function motionSummary\(/);
});
