'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validate, frameT, frameCount, solve, summarise, PieceError } = require('../core/piece.js');

/** assert.throws() returns undefined, so catch the error to read its text. */
function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

const minimal = () => ({ name: 'thing', size: { w: 100, h: 50 }, draw() {} });

test('a minimal piece validates and gets defaults', () => {
  const p = validate(minimal());
  assert.equal(p.seed, 1);
  assert.equal(p.time, null, 'a piece has no timeline unless it asks for one');
  assert.deepEqual(p.outputs, ['raster']);
  assert.deepEqual(p.build, []);
  assert.deepEqual(p.params, {});
  assert.deepEqual(p.state(), {});
  assert.equal(p.preview, null, 'GPU preview is opt-in');
});

test('pixel preview requires an explicit bounded descriptor and a CPU draw', () => {
  const preview = { kind: 'webgpu-pixels', wgsl: 'fn artifexPixel(p: vec2f) -> vec3f { return vec3f(p, 0); }', uniforms: () => [] };
  assert.equal(validate({ ...minimal(), preview }).preview, preview);
  assert.throws(() => validate({ ...minimal(), preview, outputs: ['raster', 'vector'] }), /raster-only/);
  assert.throws(() => validate({ ...minimal(), preview, draw: undefined }), /draw.*function/);
  for (const value of [false, [], 1, { ...preview, kind: 'auto' }, { ...preview, wgsl: '' },
    { ...preview, wgsl: 'x'.repeat(65537) }, { ...preview, uniforms: [] }, { ...preview, shader: 'typo' }]) {
    assert.throws(() => validate({ ...minimal(), preview: value }), /preview/);
  }
});

test('an unknown key is refused and named', () => {
  // This is the check that would have caught a style block with the wrong keys
  // shipping for months in the engine this imports from.
  const e = grab(() => validate({ ...minimal(), pallete: {} }));
  assert.ok(e instanceof PieceError);
  assert.match(e.message, /unknown key\(s\): pallete/);
  assert.match(e.message, /Known keys:/);
});

test('required keys are named when missing', () => {
  for (const k of ['name', 'size', 'draw']) {
    const p = minimal();
    delete p[k];
    assert.throws(() => validate(p), new RegExp(`missing required key: ${k}`));
  }
});

test('size must be a positive finite box, and carries no other keys', () => {
  assert.throws(() => validate({ ...minimal(), size: { w: 0, h: 10 } }), /size\.w must be a positive/);
  assert.throws(() => validate({ ...minimal(), size: { w: 10, h: Infinity } }), /size\.h must be a positive/);
  assert.throws(() => validate({ ...minimal(), size: { w: 10, h: 10, dpr: 2 } }), /unknown key\(s\) in size: dpr/);
});

test('A STILL IS A LEGAL PIECE, and a timeline is opt-in', () => {
  assert.doesNotThrow(() => validate({ ...minimal(), time: null }));
  assert.doesNotThrow(() => validate({ ...minimal(), time: { duration: 4, hz: 12 } }));
  assert.doesNotThrow(() => validate({ ...minimal(), time: { duration: 4, hz: 12, loop: true } }));
  // `hold` was accepted by the contract, asserted by this very test, and read
  // by nothing -- a declaration that could not fail, two commits after the same
  // disease was cured for `params`. It is gone, and it is refused by name.
  assert.throws(() => validate({ ...minimal(), time: { duration: 4, hz: 12, hold: 1 } }), /unknown key\(s\) in time: hold/);
  assert.throws(() => validate({ ...minimal(), time: { duration: 4, hz: 12, fps: 24 } }), /unknown key\(s\) in time: fps/);
  assert.throws(() => validate({ ...minimal(), time: { duration: 0, hz: 12 } }), /time\.duration must be a positive/);
});

test('a still quantises every playhead to one frame', () => {
  const p = validate(minimal());
  assert.equal(frameCount(p), 1);
  for (const t of [0, 0.3, 0.999, 1]) assert.equal(frameT(p, t), 0);
});

test('a timeline quantises to the drawn-frame grid, and clamps outside [0,1]', () => {
  const p = validate({ ...minimal(), time: { duration: 2, hz: 10 } }); // 20 frames
  assert.equal(frameCount(p), 20);
  assert.equal(frameT(p, 0), 0);
  assert.equal(frameT(p, 1), 1);
  // 20 frames span [0,1] inclusive, so they sit at i/19 and NOTHING lands on
  // 0.5. The old lattice put them at i/20 -- 21 positions for 20 frames -- and
  // that spare position is the frame every video export used to drop.
  assert.equal(frameT(p, 0.5), 10 / 19);
  // 0.47 * 20 = 9.4 -> frame 9 -> 0.45
  assert.ok(Math.abs(frameT(p, 0.47) - 9 / 19) < 1e-12);
  assert.equal(frameT(p, -3), 0);
  assert.equal(frameT(p, 7), 1);
});

test('outputs: vector is a claim that must be made, and raster is always true', () => {
  assert.deepEqual(validate({ ...minimal(), outputs: ['raster', 'vector'] }).outputs, ['raster', 'vector']);
  assert.throws(() => validate({ ...minimal(), outputs: ['vector'] }), /must include 'raster'/);
  assert.throws(() => validate({ ...minimal(), outputs: ['pdf'] }), /unknown output "pdf"/);
  assert.throws(() => validate({ ...minimal(), outputs: [] }), /non-empty array/);
});

const knob = (over) => ({ min: 0, max: 1, value: 0.5, meaning: 'how wide the gap is', ...over });

test('a declared parameter must have a value inside its own range', () => {
  assert.doesNotThrow(() => validate({ ...minimal(), params: { k: knob() } }));
  assert.throws(() => validate({ ...minimal(), params: { k: knob({ min: 1, max: 0 }) } }), /min must be less than max/);
  assert.throws(() => validate({ ...minimal(), params: { k: knob({ value: 2 }) } }), /value must lie in \[min, max\]/);
});

test('a declared parameter must SAY WHAT IT DOES, and the saying is not optional', () => {
  // Three numbers and a source comment is a knob only one kind of reader can
  // use. The page shows this string under the slider and the contact sheet
  // lists it, so a reader who cannot open the file still knows what moving it
  // will do -- which is the difference between sweeping a parameter and
  // guessing at one.
  const e = grab(() => validate({ ...minimal(), params: { k: { min: 0, max: 1, value: 0.5 } } }));
  assert.ok(e instanceof PieceError);
  assert.match(e.message, /params\.k\.meaning must be a non-empty string/);
  assert.throws(() => validate({ ...minimal(), params: { k: knob({ meaning: '   ' }) } }), /meaning must be a non-empty string/);
  assert.throws(() => validate({ ...minimal(), params: { k: knob({ meaning: 42 }) } }), /meaning must be a non-empty string/);
  assert.throws(() => validate({ ...minimal(), params: { k: knob({ meaning: 'x'.repeat(121) }) } }), /at most 120 characters/);
});

test('a params entry carries no keys beyond the four, and a misspelling is named', () => {
  // The same guard `size` and `time` already have, and for the same reason: a
  // key the contract ignores is a declaration that cannot fail. `step` and
  // `label` are the two an author reaches for first.
  assert.throws(() => validate({ ...minimal(), params: { k: knob({ step: 0.1 }) } }), /unknown key\(s\) in params\.k: step/);
  assert.throws(() => validate({ ...minimal(), params: { k: knob({ label: 'gap' }) } }), /unknown key\(s\) in params\.k: label/);
  assert.throws(() => validate({ ...minimal(), params: { k: knob({ meanning: 'typo' }) } }), /unknown key\(s\) in params\.k: meanning/);
});

test('build stages must be named, because a stage that throws is reported by name', () => {
  assert.throws(() => validate({ ...minimal(), build: [[null, () => {}]] }), /build\[0\]\[0\] must be a non-empty name/);
  assert.throws(() => validate({ ...minimal(), build: [['a']] }), /build\[0\] must be \[name, fn\]/);
});

test('solve reports every DECLARED stage, not only the ones that finished', () => {
  const p = validate({
    ...minimal(),
    state: () => ({ log: [] }),
    build: [
      ['one', (s) => s.log.push(1)],
      ['two', () => { throw new Error('boom'); }],
      ['three', (s) => s.log.push(3)],
    ],
  });
  const r = solve(p, 7);
  assert.equal(r.seed, 7);
  assert.deepEqual(r.state.log, [1]);
  assert.equal(r.stages.of, 3, 'the DECLARED count, so a skipped stage cannot hide');
  assert.equal(r.stages.ms.length, 1);
  assert.equal(r.stages.error.stage, 'two');
  assert.equal(r.stages.error.at, 1);
  assert.match(r.stages.error.message, /boom/);
});

test('a build can be stopped at a named stage, and an unknown name is refused', () => {
  const p = validate({
    ...minimal(),
    state: () => ({ log: [] }),
    build: [
      ['one', (s) => s.log.push(1)],
      ['two', (s) => s.log.push(2)],
      ['three', (s) => s.log.push(3)],
    ],
  });

  const half = solve(p, 7, {}, { until: 'two' });
  assert.deepEqual(half.state.log, [1, 2], 'the named stage RUNS, and nothing after it does');
  assert.equal(half.stages.ms.length, 2);
  assert.equal(half.stages.of, 3, 'and the declared count still says how many there were');
  assert.equal(half.stages.error, null);

  // The first stage and the last one both, because a `break` in the wrong place
  // is right in the middle and wrong at the ends.
  assert.deepEqual(solve(p, 7, {}, { until: 'one' }).state.log, [1]);
  assert.deepEqual(solve(p, 7, {}, { until: 'three' }).state.log, [1, 2, 3]);
  assert.deepEqual(solve(p, 7).state.log, [1, 2, 3], 'and no `until` runs everything');

  // AN UNKNOWN NAME IS REFUSED, NOT IGNORED. If it meant "run everything", the
  // finished state would come back looking exactly like a stage that produced
  // all of it -- so a typo in a stage name would answer a question about step 2
  // with the contents of step 7, and read as a correct answer.
  const e = grab(() => solve(p, 7, {}, { until: 'tow' }));
  assert.ok(e instanceof PieceError);
  assert.match(e.message, /no build stage called "tow"/);
  assert.match(e.message, /Declared: one, two, three/);
});

test('summarise describes a build state instead of copying it', () => {
  // Raw state is typed arrays and nested polylines: JSON.stringify of it is
  // either wrong (a Float64Array becomes an object of indices) or megabytes.
  // What a reader outside the build wants is the SHAPE, one level down.
  const got = summarise({
    seed: 7,
    name: 'thing',
    done: true,
    nothing: null,
    field: Float64Array.from([2, -1, 4]),
    counts: [3, 1, 2],
    empty: [],
    forms: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    params: { relief: 1.15, wells: 4 },
  });

  assert.deepEqual(got.seed, 7, 'a number is itself');
  assert.deepEqual(got.name, 'thing');
  assert.deepEqual(got.done, true);
  assert.deepEqual(got.nothing, null);
  assert.deepEqual(got.field, { length: 3, kind: 'Float64Array', min: -1, max: 4 },
    'a typed array reports its kind and the range it spans, not its contents');
  assert.deepEqual(got.counts, { length: 3, kind: 'array', min: 1, max: 3 });
  assert.deepEqual(got.empty, { length: 0, kind: 'array' }, 'and an empty list claims no range');
  assert.deepEqual(got.forms, { length: 2, kind: 'array', of: { keys: ['x', 'y'] } },
    'a list of objects says what is IN it -- "2 things" answers nothing');
  assert.deepEqual(got.params, { keys: ['relief', 'wells'] },
    'and an object is named rather than descended into');

  // The whole point is that it survives the trip to a caller outside the page.
  assert.deepEqual(JSON.parse(JSON.stringify(got)), got);
});

test('summarise reaches the shape of a real piece part-way through its build', () => {
  // The unit test above builds a state by hand, so it cannot notice summarise
  // being wired to nothing. This drives a shipped piece through the stage seam
  // and asserts the two stages report DIFFERENT shapes -- which is the entire
  // reason to look at an intermediate step.
  const p = validate(require('../examples/contours.js'));
  const names = p.build.map(([n]) => n);
  assert.ok(names.length >= 2, `contours has ${names.length} build stages`);
  const first = summarise(solve(p, 2026, {}, { until: names[0] }).state);
  const last = summarise(solve(p, 2026).state);
  assert.equal(first.paths.length, 0, 'nothing is traced before the tracing stage');
  assert.ok(last.paths.length > 0, 'and something is traced after it');
  assert.ok(Number.isFinite(first.field.min) && first.field.kind === 'Float64Array',
    `the sampled field came back as ${JSON.stringify(first.field)}`);
});

test('seed zero is a seed', () => {
  const p = validate({ ...minimal(), seed: 0 });
  assert.equal(p.seed, 0);
  assert.equal(solve(p).seed, 0);
});
