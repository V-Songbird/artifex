'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { renderVector, playheads, drawFrame } = require('../core/render.js');
const { validate, solve, frameT, frameCount, frameDen, frameIndex } = require('../core/piece.js');
const { VectorSurface } = require('../core/surface-vector.js');

function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

// A deliberately NON-ORGANIC fixture. The example a library ships becomes the
// shape of what gets made with it, and that applies to test fixtures an author
// reads too -- so this one is a hard-edged graphic mark on a grid, not a plant.
// See docs/subject-neutrality.md.
function bars(extra = {}) {
  return validate({
    name: 'bars',
    size: { w: 120, h: 60 },
    outputs: ['raster', 'vector'],
    state: () => ({ xs: [] }),
    build: [['lay out', (s) => {
      let h = s.seed >>> 0;
      for (let i = 0; i < 6; i++) {
        h = (h * 1664525 + 1013904223) >>> 0;   // any addressed source would do here
        s.xs.push(4 + (h % 40) / 2);
      }
    }]],
    draw(g, s, t) {
      g.fillStyle = '#202020';
      for (let i = 0; i < s.xs.length; i++) {
        const h = s.xs[i] * (0.2 + 0.8 * t);
        g.beginPath();
        g.rect(8 + i * 18, 52 - h, 12, h);
        g.fill();
      }
    },
    ...extra,
  });
}

test('vector output is REFUSED for a piece that did not declare it', () => {
  const p = validate({ name: 'q', size: { w: 10, h: 10 }, draw(g) { g.beginPath(); g.rect(0, 0, 1, 1); g.fill(); } });
  const e = grab(() => renderVector(p));
  assert.match(e.message, /has not declared vector output/);
  assert.match(e.message, /"q"/, 'the piece is named');
  assert.match(e.message, /outputs: \["raster", "vector"\]/, 'and so is the fix');
});

test('a declared piece renders to a document with marks in it', () => {
  const r = renderVector(bars(), { seed: 5 });
  assert.equal(r.seed, 5);
  assert.equal(r.marks, 6);
  assert.match(r.svg, /^<svg xmlns/);
  assert.match(r.svg, /viewBox="0 0 120 60"/);
});

test('the same seed and playhead give a byte-identical document', () => {
  const a = renderVector(bars(), { seed: 11, t: 0.4 });
  const b = renderVector(bars(), { seed: 11, t: 0.4 });
  assert.equal(a.svg, b.svg);
});

test('a different seed gives a different document', () => {
  const a = renderVector(bars(), { seed: 1 });
  const b = renderVector(bars(), { seed: 2 });
  assert.notEqual(a.svg, b.svg);
});

test('a build stage that throws is reported by NAME and position', () => {
  const p = bars({ build: [['lay out', () => { throw new Error('no room'); }]] });
  const e = grab(() => renderVector(p));
  assert.match(e.message, /build stage "lay out" \(1 of 1\) threw: no room/);
});

test('a raster operation inside a vector render refuses by name', () => {
  const p = validate({
    name: 'mixed',
    size: { w: 10, h: 10 },
    outputs: ['raster', 'vector'],
    draw(g) { g.fillText('hello', 0, 0); },
  });
  const e = grab(() => renderVector(p));
  assert.match(e.message, /fillText\(\) is a raster operation/);
});

test('a still has exactly one playhead, and it is 0', () => {
  assert.deepEqual(playheads(bars()), [0]);
});

test('a timeline publishes every drawn frame, first to last', () => {
  const p = bars({ time: { duration: 1, hz: 4 } });   // 4 frames
  const ph = playheads(p);
  assert.equal(ph.length, 4);
  assert.equal(ph[0], 0);
  assert.equal(ph[ph.length - 1], 1);
  assert.deepEqual(ph, [...ph].sort((a, b) => a - b), 'in order');
  assert.equal(new Set(ph).size, ph.length, 'and no frame is drawn twice');
});

test('a still ignores the playhead entirely', () => {
  const p = bars();
  const a = renderVector(p, { seed: 3, t: 0 });
  const b = renderVector(p, { seed: 3, t: 1 });
  assert.equal(a.svg, b.svg);
  assert.equal(a.t, 0);
});

test('a timeline does not ignore it', () => {
  const p = bars({ time: { duration: 1, hz: 10 } });
  assert.notEqual(renderVector(p, { seed: 3, t: 0 }).svg, renderVector(p, { seed: 3, t: 1 }).svg);
});

test('scale is not capped, so print resolution is reachable', () => {
  const p = bars();
  const s = solve(p, 1);
  for (const k of [1, 8]) {
    const g = new VectorSurface(p.size);
    drawFrame(g, p, s, 1, { scale: k });
    const xs = [...g.toSVG().matchAll(/M([-\d.]+) /g)].map((m) => Number(m[1]));
    assert.ok(xs.length > 0);
    assert.ok(Math.abs(Math.max(...xs) - 8 * k) < 1e-6 || Math.max(...xs) > 0, 'coordinates scale with it');
  }
  const g1 = new VectorSurface(p.size); drawFrame(g1, p, s, 1, { scale: 1 });
  const g4 = new VectorSurface(p.size); drawFrame(g4, p, s, 1, { scale: 4 });
  const x1 = Number(/M([-\d.]+) /.exec(g1.toSVG())[1]);
  const x4 = Number(/M([-\d.]+) /.exec(g4.toSVG())[1]);
  assert.ok(Math.abs(x4 - 4 * x1) < 1e-6, `${x4} should be 4x ${x1}`);
});

test('scale must be a positive finite number', () => {
  const p = bars();
  const s = solve(p, 1);
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.throws(() => drawFrame(new VectorSurface(p.size), p, s, 1, { scale: bad }), /scale must be a positive finite number/);
  }
});

test('drawFrame leaves the surface state as it found it, even if draw throws', () => {
  const p = validate({ name: 'x', size: { w: 10, h: 10 }, draw(g) { g.translate(5, 5); throw new Error('mid-draw'); } });
  const g = new VectorSurface(p.size);
  assert.throws(() => drawFrame(g, p, solve(p, 1), 0), /mid-draw/);
  g.beginPath(); g.moveTo(1, 1); g.lineTo(2, 2); g.stroke();
  assert.match(g.toSVG(), /d="M1 1L2 2"/, 'the transform did not leak out of the failed draw');
});

test('a piece that draws nothing produces a document with no marks', () => {
  // Stated as a measurement rather than a pass: a liveness floor belongs beside
  // any check whose pass condition is "no difference".
  const p = validate({ name: 'empty', size: { w: 10, h: 10 }, outputs: ['raster', 'vector'], draw() {} });
  assert.equal(renderVector(p).marks, 0);
});

// ---- the frame lattice, after the walk was found to drop its middle -------

test('playheads visits EVERY drawn frame exactly once, and none of them twice', () => {
  // The bug this replaces: frameCount said n, frameT quantised onto n+1 lattice
  // positions, and playheads sampled i/(n-1) -- so Math.round silently dropped
  // exactly one frame, always the middle one, for every timeline in the
  // library. A video export was missing its centre frame and nothing said so.
  for (const time of [
    { duration: 8, hz: 30 }, { duration: 6, hz: 24 }, { duration: 1, hz: 4 },
    { duration: 8, hz: 24, loop: true }, { duration: 1.5, hz: 7 }, { duration: 2, hz: 0.5 },
  ]) {
    const p = bars({ time });
    const n = frameCount(p);
    const ph = playheads(p);
    const den = frameDen(p);
    const label = `${time.duration}x${time.hz}${time.loop ? ' loop' : ''}`;

    assert.equal(ph.length, n, `${label}: walked ${ph.length} of ${n} frames`);
    assert.equal(new Set(ph).size, n, `${label}: a frame was walked twice`);
    assert.deepEqual(ph, [...ph].sort((a, b) => a - b), `${label}: out of order`);

    // Every walked playhead is a FIXED POINT of the quantiser. If it is not,
    // the walk and the grid are two different lattices, which is the fault.
    for (const t of ph) assert.equal(frameT(p, t), t, `${label}: ${t} is not on the grid`);

    // And the walk covers the grid: no index is unreachable.
    const walked = new Set(ph.map((t) => Math.round(t * den)));
    for (let i = 0; i < n; i++) assert.ok(walked.has(i), `${label}: frame index ${i} is never walked`);
  }
});

test('a looping timeline closes: its last frame is not the first one again', () => {
  const loop = bars({ time: { duration: 4, hz: 10, loop: true } });
  const ph = playheads(loop);
  assert.equal(ph.length, 40);
  assert.equal(ph[0], 0);
  assert.equal(ph[39], 39 / 40, 'the last frame stops short of 1');
  assert.equal(frameT(loop, 1), 0, 't=1 IS t=0 on a loop, so the piece can repeat seamlessly');
  assert.equal(frameT(loop, 2.25), frameT(loop, 0.25), 'and the playhead wraps');
});

test('a timeline that does not loop reaches its final state', () => {
  const once = bars({ time: { duration: 4, hz: 10 } });
  const ph = playheads(once);
  assert.equal(ph.length, 40);
  assert.equal(ph[39], 1, 'the last frame IS the completed one, so a reveal finishes');
  assert.equal(frameT(once, 1), 1);
  assert.equal(frameT(once, 7), 1, 'and it clamps rather than wrapping');
});

test('draw is handed a clock, so a piece need not restate its own timeline', () => {
  // Before this, `draw` got the playhead and nothing else, so any piece with a
  // fixed timestep declared its own duration and hz a second time as module
  // constants -- one fact in two places, and editing the timeline without
  // editing the constants indexed the wrong frame in silence.
  let seen = null;
  const p = validate({
    name: 'clocked',
    size: { w: 10, h: 10 },
    time: { duration: 4, hz: 25 },
    draw(g, s, t, clock) { seen = clock; },
  });
  drawFrame(new VectorSurface(p.size), p, solve(p, 1), 0.5);
  assert.deepEqual(seen, { frame: 50, frames: 100, seconds: 2, duration: 4, hz: 25, loop: false });

  drawFrame(new VectorSurface(p.size), p, solve(p, 1), 1);
  assert.equal(seen.frame, 99, 'the last frame index is frames-1, not frames');

  const still = validate({ name: 'unclocked', size: { w: 10, h: 10 }, draw(g, s, t, clock) { seen = clock; } });
  drawFrame(new VectorSurface(still.size), still, solve(still, 1), 0.7);
  assert.deepEqual(seen, { frame: 0, frames: 1, seconds: 0, duration: 0, hz: 0, loop: false },
    'and a still gets a clock that says it has no timeline');
});

test('the frame index is an integer in [0, frames-1] wherever the playhead lands', () => {
  for (const time of [{ duration: 3, hz: 11 }, { duration: 3, hz: 11, loop: true }, { duration: 0.4, hz: 9 }]) {
    const p = bars({ time });
    const n = frameCount(p);
    for (let k = -50; k <= 250; k++) {
      const i = frameIndex(p, k / 200);
      assert.ok(Number.isInteger(i) && i >= 0 && i < n, `${k / 200} -> ${i} of ${n}`);
    }
  }
});
