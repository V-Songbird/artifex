'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validate, atBox, frameT, frameCount, clockAt, solve, summarise, PieceError } = require('../core/piece.js');

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
  assert.match(e.message, /; spell a misspelled key as listed, and keep the piece's own values and helpers in state\(\), a build stage or the piece's module, outside the piece object$/);
});

test('required keys are named when missing', () => {
  for (const k of ['name', 'size', 'draw']) {
    const p = minimal();
    delete p[k];
    assert.throws(() => validate(p), new RegExp(`missing required key: ${k}`));
  }
});

test('a validate refusal carries what it read as data, and any other refusal carries null', () => {
  const { FIELDS } = require('../core/piece.js');
  const read = (piece) => grab(() => validate(piece)).diagnostic;
  assert.deepEqual(read([]), { code: 'not-object', path: '', expected: 'object', got: 'array' });
  assert.deepEqual(read(null), { code: 'not-object', path: '', expected: 'object', got: 'null' });
  const unknown = read({ ...minimal(), pallete: {}, sise: 1 });
  assert.deepEqual([unknown.code, unknown.path, unknown.got], ['unknown-key', '', ['pallete', 'sise']]);
  assert.deepEqual(unknown.expected, Object.keys(FIELDS));
  const p = minimal();
  delete p.draw;
  assert.deepEqual(read(p), { code: 'missing-key', path: 'draw', expected: FIELDS.draw.doc });
  assert.deepEqual(read({ ...minimal(), size: { w: 0, h: 10 } }), { code: 'invalid-field', path: 'size', expected: FIELDS.size.doc });
  const e = grab(() => validate({ ...minimal(), sound: () => [] }));
  assert.equal(e.message, 'sound: a soundtrack needs a timeline; declare time: { duration, hz }', 'the message is unchanged');
  assert.deepEqual(e.diagnostic, { code: 'conflict', path: 'sound' });
  assert.deepEqual(read({ ...minimal(), boxes: { w: [200, 400], h: [25, 200] } }), { code: 'conflict', path: 'boxes' });
  assert.equal(grab(() => atBox(validate(minimal()), { w: 50, h: 25 })).diagnostic, null);
  assert.equal(grab(() => solve(validate(minimal()), 1, { nope: 1 })).diagnostic, null);
});

test('size must be a positive finite box, and carries no other keys', () => {
  assert.throws(() => validate({ ...minimal(), size: { w: 0, h: 10 } }), /size\.w must be a positive/);
  assert.throws(() => validate({ ...minimal(), size: { w: 10, h: Infinity } }), /size\.h must be a positive/);
  assert.throws(() => validate({ ...minimal(), size: { w: 10, h: 10, dpr: 2 } }), /unknown key\(s\) in size: dpr/);
});

test('a time that is not an object names its fields with their units', () => {
  assert.throws(() => validate({ ...minimal(), time: 5 }), /duration \(seconds\), hz \(frames per second\)/);
});

test('boxes are opt-in ranges that hold the size, and carry no other keys', () => {
  assert.equal(validate(minimal()).boxes, null, 'a piece draws at one box unless it declares more');
  const boxes = { w: [50, 400], h: [25, 200] };
  assert.equal(validate({ ...minimal(), boxes }).boxes, boxes);
  assert.throws(() => validate({ ...minimal(), boxes: { w: [200, 400], h: [25, 200] } }), /boxes: size w 100 is outside the declared \[200, 400\]/);
  assert.throws(() => validate({ ...minimal(), boxes: { w: [50, 400], h: [60, 200] } }), /boxes: size h 50 is outside/);
  assert.throws(() => validate({ ...minimal(), boxes: { ...boxes, aspect: [1, 2] } }), /unknown key\(s\) in boxes: aspect/);
  assert.throws(() => validate({ ...minimal(), boxes: { w: [400, 50], h: [25, 200] } }), /boxes\.w: min must not exceed max/);
  for (const w of [[50], [0, 400], [50, Infinity], '50-400']) {
    assert.throws(() => validate({ ...minimal(), boxes: { w, h: [25, 200] } }), /boxes\.w must be \[min, max\]/);
  }
  assert.throws(() => validate({ ...minimal(), boxes: [] }), /boxes: must be null/);
});

test('atBox redraws a piece at a declared box and refuses any other, by name', () => {
  const p = validate({ ...minimal(), boxes: { w: [50, 400], h: [25, 200] } });
  const narrow = atBox(p, { w: 60, h: 200 });
  assert.deepEqual(narrow.size, { w: 60, h: 200 });
  assert.deepEqual(p.size, { w: 100, h: 50 }, 'the declared piece is not changed');
  assert.equal(atBox(p, { w: 100, h: 50 }), p, 'its own size is itself');
  assert.throws(() => atBox(p, { w: 401, h: 50 }), { message: 'atBox: thing cannot draw at 401 x 50: w 401 is outside the declared [50, 400]; it takes widths 50 to 400 and heights 25 to 200' });
  assert.throws(() => atBox(p, { w: 100, h: 24 }), /h 24 is outside/);
  assert.throws(() => atBox(p, { w: NaN, h: 50 }), /a box is \{ w, h \}/);
  const fixed = validate(minimal());
  assert.equal(atBox(fixed, { w: 100, h: 50 }), fixed, 'a fixed piece accepts its own size');
  assert.throws(() => atBox(fixed, { w: 60, h: 50 }), /thing declares no boxes, so it draws only at 100 x 50/);
});

test('a piece that declares boxes is solved for its box, and the recipe names it', () => {
  const seen = [];
  const p = validate({
    ...minimal(),
    boxes: { w: [50, 400], h: [25, 200] },
    build: [['read the box', (s) => { seen.push({ ...s.box }); }]],
  });
  const at = solve(atBox(p, { w: 300, h: 30 }));
  assert.deepEqual(seen, [{ w: 300, h: 30 }], 'the build stages read the box they are solved for');
  assert.deepEqual(at.state.box, { w: 300, h: 30 });
  assert.deepEqual(at.manifest.size, { w: 300, h: 30 });
  assert.deepEqual(solve(p).state.box, { w: 100, h: 50 }, 'with no box chosen, it is the size');
  assert.equal('box' in solve(validate(minimal())).state, false, 'a piece without boxes keeps the state it always had');
});

test('a box timeline is refused by name unless it moves, fits the boxes and keeps the largest as the frame', () => {
  const boxed = { ...minimal(), size: { w: 200, h: 100 }, boxes: { w: [50, 400], h: [25, 200] }, time: { duration: 2, hz: 10 } };
  const keys = [{ t: 0, w: 200, h: 50 }, { t: 1, w: 80, h: 100 }];
  assert.equal(validate(boxed).reframe, null, 'a piece plays one box unless it declares a timeline');
  assert.deepEqual(validate({ ...boxed, reframe: keys }).reframe, keys);
  const refused = [
    [[keys[0]], /reframe: must be null or \[\{ t, w, h \}, \.\.\.\] with two or more boxes/],
    [[keys[0], { ...keys[1], at: 1 }], /unknown key\(s\) in reframe\[1\]: at/],
    [[keys[0], { ...keys[1], t: 1.5 }], /reframe\[1\]\.t must be a playhead in \[0, 1\]/],
    [[keys[0], { ...keys[1], w: 0 }], /reframe\[1\]\.w must be a positive finite number/],
    [[keys[0], { ...keys[1], t: 0 }], /reframe\[1\]\.t must come after reframe\[0\]\.t: the box moves, it never cuts/],
    [[keys[0], { ...keys[1], h: 300 }], /reframe: box 1, 80 x 300: h 300 is outside the declared \[25, 200\]/],
    [[keys[0], { ...keys[1], h: 90 }], /reframe: size must be the largest box, 200 x 90, which stays the film's frame; got 200 x 100/],
  ];
  for (const [reframe, why] of refused) assert.throws(() => validate({ ...boxed, reframe }), why);
  assert.throws(() => validate({ ...boxed, boxes: null, reframe: keys }), /reframe: thing declares no boxes/);
  assert.throws(() => validate({ ...boxed, time: null, reframe: keys }), /reframe: a box timeline needs a timeline/);
});

test('a box timeline moves the box rest to rest, centred in its frame, and holds it at either end', () => {
  const p = validate({
    ...minimal(), size: { w: 200, h: 100 }, boxes: { w: [50, 400], h: [25, 200] }, time: { duration: 2, hz: 10.5 },
    reframe: [{ t: 0.25, w: 200, h: 50 }, { t: 0.75, w: 80, h: 100 }],
  });
  assert.equal('box' in clockAt(validate({ ...minimal(), time: { duration: 2, hz: 10 } }), 0.5), false, 'a clock without a timeline is unchanged');
  const at = (t) => clockAt(p, t).box;
  assert.deepEqual(at(0), { w: 200, h: 50, x: 0, y: 25, from: 0, to: 1, u: 0 }, 'held before the first box');
  assert.deepEqual(at(0.25), at(0), 'at rest at the first box');
  const mid = at(0.5);
  assert.ok(Math.abs(mid.w - 140) < 1e-9 && Math.abs(mid.h - 75) < 1e-9 && mid.u === 0.5, 'halfway between at the middle');
  assert.ok(Math.abs(mid.x - 30) < 1e-9 && Math.abs(mid.y - 12.5) < 1e-9, 'centred in the frame');
  assert.ok(200 - at(0.3).w < 6, 'it leaves from rest, slower than at a constant speed');
  assert.deepEqual(at(1), { w: 80, h: 100, x: 60, y: 0, from: 1, to: 1, u: 0 }, 'held after the last box');
  assert.deepEqual(at(0.52), at(0.5), 'read at the drawn frame the playhead falls on');
  const s = solve(p);
  assert.deepEqual(s.state.box, { w: 200, h: 100 }, 'the build is solved for the frame');
  assert.deepEqual(s.state.reframe, p.reframe, 'and told every box of the timeline');
  assert.deepEqual(s.manifest.reframe, p.reframe, 'the recipe names the timeline');
  assert.equal('reframe' in solve(validate(minimal())).state, false, 'a piece without one keeps the state it always had');
  assert.equal('reframe' in solve(validate(minimal())).manifest, false, 'and the recipe it always had');
});

test('atBox plays a box timeline, and one box replaces a timeline, even at the piece\'s own size', () => {
  const p = validate({ ...minimal(), boxes: { w: [50, 400], h: [25, 200] }, time: { duration: 2, hz: 10 } });
  const keys = [{ t: 0, w: 300, h: 40 }, { t: 1, w: 60, h: 180 }];
  const played = atBox(p, keys);
  assert.deepEqual(played.size, { w: 300, h: 180 }, 'the frame is the widest width by the tallest height');
  assert.deepEqual(played.reframe, keys);
  assert.deepEqual(solve(played).manifest.reframe, keys);
  const fixed = atBox(played, { w: 300, h: 180 });
  assert.equal(fixed.reframe, null);
  assert.equal('reframe' in solve(fixed).manifest, false);
  assert.equal(atBox(p, { w: 100, h: 50 }), p, 'a piece without a timeline at its own size is itself');
  assert.throws(() => atBox(p, [keys[0], { ...keys[1], w: 20 }]), /atBox: thing cannot play that box timeline: box 1, 20 x 180: w 20 is outside/);
  assert.throws(() => atBox(p, [keys[0]]), /cannot play that box timeline: must be null or/);
  assert.throws(() => atBox(validate({ ...minimal(), time: { duration: 2, hz: 10 } }), keys), /thing declares no boxes/);
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

test('a state() that throws is reported as a failed stage called state(), and no stage runs', () => {
  let ran = 0;
  const p = validate({ ...minimal(), state: () => { throw new Error('state boom'); }, build: [['one', () => { ran++; }]] });
  const r = solve(p, 7);
  assert.deepEqual(r.stages, { ms: [], of: 1, error: { stage: 'state()', at: -1, of: 1, message: 'state boom' } });
  assert.deepEqual([ran, r.seed, r.state.seed], [0, 7, 7]);
  // A state() that forgets its return fails the same way, by name.
  const none = solve(validate({ ...minimal(), state: () => {} }), 7);
  assert.deepEqual([none.stages.error.stage, none.stages.error.message], ['state()', 'state() returned no object']);
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

test('a soundtrack is a function or nothing, and a still cannot have one', () => {
  assert.equal(validate(minimal()).sound, null, 'no sound unless a piece declares it');
  const timed = { ...minimal(), time: { duration: 1, hz: 10 } };
  assert.equal(typeof validate({ ...timed, sound() {} }).sound, 'function');
  assert.match(grab(() => validate({ ...timed, sound: 'chime.wav' })).message, /^sound: must be null or a function/);
  const e = grab(() => validate({ ...minimal(), sound() {} }));
  assert.ok(e instanceof PieceError);
  assert.match(e.message, /sound: a soundtrack needs a timeline/);
});

/** A declared image of `w` x `h` pixels with `channels` bytes each, byte i holding i * 7 mod 256. */
const declared = (w = 4, h = 3, channels = 3) => ({
  w, h, channels, source: 'made from code', rights: 'the tests\'',
  pixels: Buffer.from(Uint8Array.from({ length: w * h * channels }, (_, i) => (i * 7) % 256)).toString('base64'),
});

test('images are opt-in, and every malformed declaration is refused by name', () => {
  assert.equal(validate(minimal()).images, null, 'no images unless a piece declares them');
  const img = declared();
  assert.equal(validate({ ...minimal(), images: { photo: img } }).images.photo, img);
  const refused = (images) => grab(() => validate({ ...minimal(), images })).message;
  const shape = 'images: must be null or { name: { w, h, channels, pixels, source, rights } }';
  for (const v of [[], 'photo.png', {}, 3]) assert.equal(refused(v), shape, JSON.stringify(v));
  assert.equal(refused({ Photo: img }), 'images: "Photo" must be a name of letters and digits that starts with a lowercase letter, such as photo or ground2');
  assert.equal(refused({ 'my-photo': img }), 'images: "my-photo" must be a name of letters and digits that starts with a lowercase letter, such as photo or ground2');
  assert.ok(validate({ ...minimal(), images: { groundTwo2: img } }), 'camelCase with digits is a name');
  assert.equal(refused({ photo: null }), 'images: images.photo must be { w, h, channels, pixels, source, rights }');
  assert.equal(refused({ photo: { ...img, url: 'x' } }), 'images: images.photo: unknown key(s): url; known: w, h, channels, pixels, source, rights');
  assert.equal(refused({ photo: { ...img, w: 2.5 } }), 'images: images.photo.w must be a positive whole number of pixels');
  assert.equal(refused({ photo: { ...img, h: 0 } }), 'images: images.photo.h must be a positive whole number of pixels');
  assert.equal(refused({ photo: { ...img, w: 4097, h: 4096 } }), 'images: images.photo is 4097 x 4096 = 16781312 pixels, over the 16777216 one image may hold');
  assert.equal(refused({ photo: { ...img, channels: 2 } }), 'images: images.photo.channels must be 1 (grey), 3 (RGB) or 4 (RGBA)');
  for (const pixels of ['AAA', 'AA*A', 'AA==A===', 7]) assert.equal(refused({ photo: { ...img, pixels } }), 'images: images.photo.pixels is not base64 text; npm run image writes it', String(pixels));
  assert.equal(refused({ photo: { ...img, pixels: img.pixels.slice(0, -4) } }), 'images: images.photo.pixels must be base64 text of 4 x 3 x 3 = 36 bytes; it holds 33');
  assert.equal(refused({ photo: { ...img, channels: 4 } }), 'images: images.photo.pixels must be base64 text of 4 x 3 x 4 = 48 bytes; it holds 36');
  const short = { ...img, w: 5, h: 1, channels: 1, pixels: Buffer.from([1, 2, 3, 4, 5]).toString('base64') };
  assert.equal(validate({ ...minimal(), images: { photo: short } }).images.photo, short, 'padding counts: 5 bytes is 8 characters with one =');
  assert.equal(refused({ photo: { ...short, w: 6 } }), 'images: images.photo.pixels must be base64 text of 6 x 1 x 1 = 6 bytes; it holds 5');
  for (const source of [undefined, '', '  ', 'x'.repeat(201)]) {
    assert.equal(refused({ photo: { ...img, source } }), 'images: images.photo.source must name where the image came from, such as the user\'s own photo or a URL, in at most 200 characters');
  }
  assert.equal(refused({ photo: { ...img, rights: '' } }), 'images: images.photo.rights must say whose the image is and on what terms, as the user gave them, in at most 200 characters; the library grants none');
});

test('a solve hands every build a fresh copy of each image, and only a piece that declares images has them', () => {
  assert.equal('images' in solve(validate(minimal())).state, false);
  const img = declared();
  let seen = null;
  const p = validate({ ...minimal(), images: { photo: img }, build: [['spoil', (s) => { seen = s.images.photo; if (s.seed === 1) s.images.photo.data.fill(0); }]] });
  const first = solve(p, 1);
  assert.deepEqual(Object.keys(seen), ['w', 'h', 'channels', 'data', 'source', 'rights']);
  assert.ok(first.state.images.photo.data.every((v) => v === 0), 'the build wrote into its own copy');
  const second = solve(p, 2).state.images.photo.data;
  const want = Buffer.from(img.pixels, 'base64');
  let at = -1;
  for (let i = 0; i < want.length && at < 0; i++) if (second[i] !== want[i]) at = i;
  assert.equal(at, -1, 'the next solve reads the declared bytes, untouched by the last build');
  assert.equal(second.length, want.length);
});

test('the manifest names every image by size, digest, source and rights, never its pixels, and a changed byte changes the digest', () => {
  assert.equal('images' in solve(validate(minimal())).manifest, false, 'a recipe without images has no key');
  const img = declared();
  const { images } = solve(validate({ ...minimal(), images: { photo: img } })).manifest;
  assert.deepEqual(Object.keys(images.photo), ['w', 'h', 'channels', 'digest', 'source', 'rights']);
  assert.match(images.photo.digest, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(images.photo.source, 'made from code');
  const bytes = Buffer.from(img.pixels, 'base64');
  bytes[17] ^= 1;
  const other = solve(validate({ ...minimal(), images: { photo: { ...img, pixels: bytes.toString('base64') } } })).manifest.images.photo;
  assert.notEqual(other.digest, images.photo.digest);
  // FNV-1a of the empty string and of "a", the algorithm's published values.
  const { digest } = require('../core/image.js');
  assert.equal(digest(new Uint8Array(0)), 'fnv1a32:811c9dc5');
  assert.equal(digest(Uint8Array.of(0x61)), 'fnv1a32:e40c292c');
});
