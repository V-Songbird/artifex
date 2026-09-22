'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { VectorSurface, RASTER_ONLY } = require('../core/surface-vector.js');
const { nullSurface } = require('../tools/bench.js');

// ---- helpers: read the emitted path back, so geometry claims are measured ----

function parsePath(d) {
  const out = [];
  const re = /([MLCAZ])([^MLCAZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = m[2].trim() === '' ? [] : m[2].trim().split(/[\s,]+/).map(Number);
    out.push({ cmd: m[1], nums });
  }
  return out;
}

/** Sample every segment of a path, returning points in device space. */
function samplePoints(d, per = 24) {
  const segs = parsePath(d);
  const pts = [];
  let cur = null, start = null;
  for (const s of segs) {
    if (s.cmd === 'M') { cur = [s.nums[0], s.nums[1]]; start = cur; pts.push(cur); }
    else if (s.cmd === 'L') { cur = [s.nums[0], s.nums[1]]; pts.push(cur); }
    else if (s.cmd === 'C') {
      const [x1, y1, x2, y2, x, y] = s.nums;
      const p0 = cur;
      for (let i = 1; i <= per; i++) {
        const t = i / per, u = 1 - t;
        pts.push([
          u * u * u * p0[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
          u * u * u * p0[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
        ]);
      }
      cur = [x, y];
    } else if (s.cmd === 'A') {
      // Read SVG endpoint form independently of the renderer's centre form.
      let [rx, ry, degrees, large, sweep, x, y] = s.nums;
      const phi = degrees * Math.PI / 180, c = Math.cos(phi), sn = Math.sin(phi);
      const dx = (cur[0] - x) / 2, dy = (cur[1] - y) / 2;
      const px = c * dx + sn * dy, py = -sn * dx + c * dy;
      const correction = Math.sqrt(px * px / (rx * rx) + py * py / (ry * ry));
      if (correction > 1) { rx *= correction; ry *= correction; }
      const ratio = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px)
        / (rx * rx * py * py + ry * ry * px * px))) * (large === sweep ? -1 : 1);
      const ox = ratio * rx * py / ry, oy = -ratio * ry * px / rx;
      const cx = c * ox - sn * oy + (cur[0] + x) / 2;
      const cy = sn * ox + c * oy + (cur[1] + y) / 2;
      const a = Math.atan2((py - oy) / ry, (px - ox) / rx);
      const end = Math.atan2((-py - oy) / ry, (-px - ox) / rx);
      let delta = end - a;
      if (sweep && delta < 0) delta += Math.PI * 2;
      if (!sweep && delta > 0) delta -= Math.PI * 2;
      for (let i = 1; i <= per; i++) {
        const angle = a + delta * i / per;
        const xx = rx * Math.cos(angle), yy = ry * Math.sin(angle);
        pts.push([cx + c * xx - sn * yy, cy + sn * xx + c * yy]);
      }
      cur = [x, y];
    } else if (s.cmd === 'Z') { cur = start; }
  }
  return pts;
}

function bbox(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function firstPathD(svg) {
  const m = /<path [^>]*d="([^"]*)"/.exec(svg);
  return m ? m[1] : null;
}

/** assert.throws() returns undefined, so catch the error to read its text. */
function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

const S = (o) => new VectorSurface({ w: 100, h: 100 }, o);

// ---- refusals ---------------------------------------------------------------

test('every raster operation refuses BY NAME and says what to do instead', () => {
  const g = S();
  for (const op of Object.keys(RASTER_ONLY)) {
    const e = grab(() => g[op]());
    assert.match(e.message, new RegExp(`\\b${op}\\(\\)`), `${op} must name itself`);
    assert.match(e.message, /vector surface:/);
  }
});

test('clearRect refuses, because SVG has no eraser and a plotter would still draw', () => {
  const e = grab(() => S().clearRect(0, 0, 10, 10));
  assert.match(e.message, /clearRect\(\) cannot erase/);
  assert.match(e.message, /plotter/);
});

test('a non-finite coordinate throws rather than reaching the file', () => {
  const g = S();
  g.beginPath();
  assert.throws(() => g.moveTo(NaN, 0), /non-finite coordinate/);
  assert.throws(() => g.lineTo(0, Infinity), /non-finite coordinate/);
});

// ---- geometry ---------------------------------------------------------------

test('the transform is baked into coordinates', () => {
  const g = S();
  g.translate(10, 20);
  g.scale(2, 3);
  g.beginPath(); g.moveTo(1, 1); g.lineTo(2, 2); g.fill();
  assert.equal(firstPathD(g.toSVG()), 'M12 23L14 26');
});

test('quadraticCurveTo is degree-elevated exactly, not approximated', () => {
  const g = S();
  g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(3, 3, 6, 0); g.stroke();
  // control points of the exact cubic equivalent: P0 + 2/3(C-P0), P3 + 2/3(C-P3)
  assert.equal(firstPathD(g.toSVG()), 'M0 0C2 2 4 2 6 0');
});

test('a full arc is an exact circle serialized as two SVG arcs', () => {
  const g = S();
  g.beginPath(); g.arc(50, 50, 40, 0, Math.PI * 2); g.stroke();
  const d = firstPathD(g.toSVG());
  assert.equal(parsePath(d).filter((part) => part.cmd === 'A').length, 2);
  assert.ok(!d.includes('C'));
  const pts = samplePoints(d, 64);
  let worst = 0;
  for (const [x, y] of pts) worst = Math.max(worst, Math.abs(Math.hypot(x - 50, y - 50) - 40) / 40);
  assert.ok(worst < 1e-12, `worst radial error ${worst}`);
  assert.equal(pts.length, 129);
});

test('vector and null surfaces report independently specified affine transform order', () => {
  for (const g of [S(), nullSurface({ w: 100, h: 100 })]) {
    assert.deepEqual(g.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    g.translate(7, 11);
    g.transform(2, 3, 4, 5, 6, 8);
    assert.deepEqual(g.getTransform(), { a: 2, b: 3, c: 4, d: 5, e: 13, f: 19 });
    g.translate(10, -2);
    g.scale(-2, 0.5);
    assert.deepEqual(g.getTransform(), { a: -4, b: -6, c: 2, d: 2.5, e: 25, f: 39 });
    g.setTransform(1, 2, 3, 4, 5, 6);
    g.rotate(Math.PI / 2);
    const got = Object.values(g.getTransform());
    for (const [i, expected] of [3, 4, -1, -2, 5, 6].entries()) assert.ok(Math.abs(got[i] - expected) < 1e-12);
  }
});

test('transform snapshots are detached numeric objects and survive later surface changes', () => {
  for (const g of [S(), nullSurface({ w: 100, h: 100 })]) {
    g.setTransform(2, 3, 4, 5, 6, 7);
    const first = g.getTransform(), second = g.getTransform();
    assert.notStrictEqual(first, second);
    assert.deepEqual(Object.keys(first), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.ok(Object.values(first).every((value) => typeof value === 'number'));
    first.a = 900; first.e = -20;
    assert.deepEqual(g.getTransform(), { a: 2, b: 3, c: 4, d: 5, e: 6, f: 7 });
    g.resetTransform();
    assert.deepEqual(second, { a: 2, b: 3, c: 4, d: 5, e: 6, f: 7 });
    assert.deepEqual(g.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  }
});

test('vector and null transform stacks restore nested snapshots after replacement and reset', () => {
  for (const g of [S(), nullSurface({ w: 100, h: 100 })]) {
    g.translate(9, 12);
    g.save(); g.scale(2, 3); g.save();
    g.setTransform(4, 5, 6, 7, 8, 9); g.resetTransform();
    g.restore();
    assert.deepEqual(g.getTransform(), { a: 2, b: 0, c: 0, d: 3, e: 9, f: 12 });
    g.restore();
    assert.deepEqual(g.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 9, f: 12 });
    g.restore();
    assert.deepEqual(g.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 9, f: 12 }, 'an empty restore does not change the matrix');
  }
});

test('an arc under a NON-UNIFORM scale becomes a real ellipse', () => {
  // General affine ellipses retain the established cubic approximation.
  const g = S();
  g.scale(2, 1);
  g.beginPath(); g.arc(10, 10, 1, 0, Math.PI * 2); g.stroke();
  const d = firstPathD(g.toSVG());
  assert.ok(d.includes('C') && !d.includes('A'));
  const points = samplePoints(d, 64);
  const b = bbox(points);
  assert.ok(Math.abs((b.x1 - b.x0) - 4) < 2e-3, `width ${b.x1 - b.x0}`);
  assert.ok(Math.abs((b.y1 - b.y0) - 2) < 2e-3, `height ${b.y1 - b.y0}`);
  for (const [x, y] of points) {
    assert.ok(Math.abs(Math.hypot((x - 20) / 2, y - 10) - 1) < 3e-4, 'affine fallback retains its radial accuracy');
  }
});

test('similarity arcs transform both ellipse axes and reverse reflected sweeps', () => {
  for (const reflect of [false, true]) {
    const g = S();
    const angle = 0.41, c = Math.cos(angle) * 2, s = Math.sin(angle) * 2;
    const matrix = [c, s, reflect ? s : -s, reflect ? -c : c, 30, 40];
    g.setTransform(...matrix);
    g.beginPath(); g.ellipse(0, 0, 12, 4, 0.27, -0.3, 4.1); g.stroke();
    const d = firstPathD(g.toSVG());
    const arcs = parsePath(d).filter((part) => part.cmd === 'A');
    assert.equal(arcs.length, 1);
    assert.deepEqual(arcs[0].nums.slice(0, 2), [24, 8]);
    assert.equal(arcs[0].nums[3], 1, 'a sweep longer than pi uses the large arc');
    assert.equal(arcs[0].nums[4], reflect ? 0 : 1);
    const det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    for (const [x, y] of samplePoints(d, 60)) {
      const u = (matrix[3] * (x - 30) - matrix[2] * (y - 40)) / det;
      const v = (-matrix[1] * (x - 30) + matrix[0] * (y - 40)) / det;
      const ex = Math.cos(0.27) * u + Math.sin(0.27) * v;
      const ey = -Math.sin(0.27) * u + Math.cos(0.27) * v;
      assert.ok(Math.abs(Math.hypot(ex / 12, ey / 4) - 1) < 2e-5, 'emitted points stay on the transformed ellipse');
    }
  }
});

test('arc serialization preserves zero, full, multiple and nearly full turns', () => {
  const tau = Math.PI * 2;
  for (const [end, ccw, count, sweep] of [[0, false, 0, 1], [tau, false, 2, 1],
    [-tau, true, 2, 0], [3 * tau, false, 2, 1], [-3 * tau, true, 2, 0],
    [2 * tau, true, 2, 0], [-2 * tau, false, 2, 1], [tau - 1e-8, false, 2, 1]]) {
    const g = S();
    g.beginPath(); g.arc(20, 30, 10, 0, end, ccw); g.stroke();
    const parts = parsePath(firstPathD(g.toSVG()));
    const arcs = parts.filter((part) => part.cmd === 'A');
    assert.equal(arcs.length, count, `${end}, ${ccw}`);
    assert.ok(arcs.every((part) => part.nums[4] === sweep));
    if (count === 2) assert.deepEqual(arcs.at(-1).nums.slice(-2), parts[0].nums, 'the serialized loop returns to its start');
  }
});

test('shear and singular transforms retain cubic arcs while roundoff rotations use SVG arcs', () => {
  for (const matrix of [[1, 0, 0.2, 1, 0, 0], [1, 0, 0, 1.000001, 0, 0], [0, 0, 0, 0, 0, 0]]) {
    const g = S(); g.setTransform(...matrix);
    g.beginPath(); g.ellipse(0, 0, 10, 5, 0.2, 0, Math.PI); g.stroke();
    const d = firstPathD(g.toSVG());
    assert.ok(d.includes('C') && !d.includes('A'));
  }
  const g = S();
  g.rotate(0.3); g.scale(2); g.rotate(-0.7);
  g.beginPath(); g.arc(0, 0, 10, 0, Math.PI); g.stroke();
  assert.ok(firstPathD(g.toSVG()).includes('A'));
});

test('an SVG arc updates the current point for the following quadratic and closes its subpath', () => {
  const g = S();
  g.beginPath(); g.moveTo(5, 5); g.arc(20, 20, 10, 0, Math.PI / 2);
  g.quadraticCurveTo(20, 33, 26, 30); g.closePath(); g.stroke();
  assert.equal(firstPathD(g.toSVG()), 'M5 5L30 20A10 10 0 0 1 20 30C20 32 22 32 26 30Z');
});

test('ellipses retain visible geometry when serialized radii round to zero', () => {
  for (const [rx, ry, scale, start, end, expected] of [
    [80, 0.000001, 1, Math.PI / 2, Math.PI * 1.5, { x0: 20, x1: 100, y0: 100, y1: 100 }],
    [0.000001, 80, 1, 0, Math.PI, { x0: 100, x1: 100, y0: 100, y1: 180 }],
    [0.001, 8000, 0.01, 0, Math.PI, { x0: 100, x1: 100, y0: 100, y1: 180 }],
  ]) {
    const g = new VectorSurface({ w: 200, h: 200 });
    g.translate(100, 100); g.scale(scale);
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, start, end); g.stroke();
    const d = firstPathD(g.toSVG());
    assert.ok(d.includes('C') && !d.includes('A'), 'an unrepresentable SVG radius keeps the cubic fallback');
    const bounds = bbox(samplePoints(d, 32));
    for (const key of Object.keys(expected)) assert.ok(Math.abs(bounds[key] - expected[key]) < 1e-9, key);
  }
  const g = S();
  g.beginPath(); g.ellipse(0, 0, 10, 0.0001, 0, 0, Math.PI); g.stroke();
  assert.ok(firstPathD(g.toSVG()).includes('A'), 'a representable positive radius still uses SVG arcs');
});

test('a counter-clockwise arc sweeps the other way', () => {
  const cw = S(); cw.beginPath(); cw.arc(0, 0, 10, 0, Math.PI / 2, false); cw.stroke();
  const ccw = S(); ccw.beginPath(); ccw.arc(0, 0, 10, 0, Math.PI / 2, true); ccw.stroke();
  const a = bbox(samplePoints(firstPathD(cw.toSVG()), 32));
  const b = bbox(samplePoints(firstPathD(ccw.toSVG()), 32));
  assert.ok(a.y0 >= -1e-9, 'the short way stays in the positive quadrant');
  assert.ok(b.y0 < -9, 'the long way sweeps through the rest of the circle');
});

test('roundRect closes, and clamps a radius that is too large for the box', () => {
  const g = S();
  g.beginPath(); g.roundRect(0, 0, 20, 10, 999); g.fill();
  const d = firstPathD(g.toSVG());
  assert.ok(d.endsWith('Z'));
  const b = bbox(samplePoints(d, 16));
  assert.ok(b.x0 >= -1e-9 && b.x1 <= 20 + 1e-9, 'stays inside the box');
  assert.ok(b.y0 >= -1e-9 && b.y1 <= 10 + 1e-9);
});

test('arcTo falls back to a corner when the points are collinear', () => {
  const g = S();
  g.beginPath(); g.moveTo(0, 0); g.arcTo(10, 0, 20, 0, 5); g.stroke();
  assert.equal(firstPathD(g.toSVG()), 'M0 0L10 0');
});

// ---- style ------------------------------------------------------------------

test('stroke width scales by sqrt(|det|) of the transform', () => {
  const g = S();
  g.scale(4, 9);           // det 36 -> factor 6
  g.lineWidth = 2;
  g.setLineDash([3, 1]);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(1, 0); g.stroke();
  const svg = g.toSVG();
  assert.match(svg, /stroke-width="12"/);
  assert.match(svg, /stroke-dasharray="18 6"/);
});

test('globalAlpha becomes fill-opacity and stroke-opacity, and 1 is omitted', () => {
  const a = S();
  a.globalAlpha = 0.25;
  a.beginPath(); a.rect(0, 0, 1, 1); a.fill(); a.stroke();
  assert.match(a.toSVG(), /fill-opacity="0\.25"/);
  assert.match(a.toSVG(), /stroke-opacity="0\.25"/);

  const b = S();
  b.beginPath(); b.rect(0, 0, 1, 1); b.fill();
  assert.ok(!/fill-opacity/.test(b.toSVG()), 'a fully opaque fill carries no opacity attribute');
});

test('the even-odd fill rule reaches the file', () => {
  const g = S();
  g.beginPath(); g.rect(0, 0, 10, 10); g.rect(2, 2, 6, 6); g.fill('evenodd');
  assert.match(g.toSVG(), /fill-rule="evenodd"/);
});

test('save and restore restore transform and style', () => {
  const g = S();
  g.fillStyle = '#111111';
  g.save();
  g.translate(50, 50);
  g.fillStyle = '#222222';
  g.restore();
  g.beginPath(); g.moveTo(0, 0); g.lineTo(1, 1); g.fill();
  const svg = g.toSVG();
  assert.equal(firstPathD(svg), 'M0 0L1 1', 'transform restored');
  assert.match(svg, /fill="#111111"/, 'style restored');
});

test('clip opens a group and restore closes it', () => {
  const g = S();
  g.save();
  g.beginPath(); g.rect(0, 0, 10, 10); g.clip();
  g.beginPath(); g.rect(0, 0, 5, 5); g.fill();
  g.restore();
  g.beginPath(); g.rect(0, 0, 1, 1); g.fill();
  const svg = g.toSVG();
  assert.match(svg, /<clipPath id="c0"><path d="M0 0L10 0L10 10L0 10Z"\/><\/clipPath>/);
  const open = (svg.match(/<g /g) || []).length;
  const close = (svg.match(/<\/g>/g) || []).length;
  assert.equal(open, close, 'every opened group is closed');
  assert.ok(svg.indexOf('</g>') < svg.lastIndexOf('<path'), 'the last fill is outside the clip');
});

test('an unclosed clip is still closed by toSVG', () => {
  const g = S();
  g.beginPath(); g.rect(0, 0, 10, 10); g.clip();
  g.beginPath(); g.rect(0, 0, 5, 5); g.fill();
  const svg = g.toSVG();
  assert.equal((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);
});

test('a gradient reaches defs with its stops sorted and the CTM on the gradient', () => {
  const g = S();
  g.translate(7, 0);
  const grad = g.createLinearGradient(0, 0, 10, 0);
  grad.addColorStop(1, '#ffffff');
  grad.addColorStop(0, '#000000');
  g.fillStyle = grad;
  g.beginPath(); g.rect(0, 0, 10, 10); g.fill();
  const svg = g.toSVG();
  assert.match(svg, /<linearGradient id="g0" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0" gradientTransform="matrix\(1 0 0 1 7 0\)">/);
  assert.match(svg, /<stop offset="0" stop-color="#000000"\/><stop offset="1" stop-color="#ffffff"\/>/);
  assert.match(svg, /fill="url\(#g0\)"/);
});

test('a radial gradient reaches defs', () => {
  const g = S();
  const grad = g.createRadialGradient(1, 2, 0, 1, 2, 5);
  grad.addColorStop(0, 'red');
  g.fillStyle = grad;
  g.beginPath(); g.rect(0, 0, 10, 10); g.fill();
  assert.match(g.toSVG(), /<radialGradient id="g0"[^>]*cx="1" cy="2" r="5"/);
});

test('a colour or a stop is escaped, so a string cannot close an attribute', () => {
  const g = S();
  g.fillStyle = '"><script>x</script>';
  g.beginPath(); g.rect(0, 0, 1, 1); g.fill();
  const svg = g.toSVG();
  assert.ok(!svg.includes('<script>'), 'markup in a style must not reach the document');
  assert.match(svg, /&quot;&gt;&lt;script&gt;/);
});

// ---- document ---------------------------------------------------------------

test('the document carries the design box as both size and viewBox', () => {
  const g = new VectorSurface({ w: 210, h: 297 });
  assert.match(g.toSVG(), /width="210" height="297" viewBox="0 0 210 297"/);
});

test('a background is optional and is laid under everything', () => {
  const g = new VectorSurface({ w: 10, h: 10 }, { background: '#eeeeee' });
  g.beginPath(); g.rect(0, 0, 1, 1); g.fill();
  const svg = g.toSVG();
  assert.ok(svg.indexOf('#eeeeee') < svg.indexOf('M0 0'), 'the ground comes first');
  assert.ok(!new VectorSurface({ w: 10, h: 10 }).toSVG().includes('<rect'), 'and is absent by default');
});

test('markCount counts painted elements, as a liveness floor for checks', () => {
  const g = S();
  assert.equal(g.markCount, 0);
  g.beginPath(); g.rect(0, 0, 1, 1); g.fill(); g.stroke();
  assert.equal(g.markCount, 2);
  g.beginPath(); g.rect(0, 0, 1, 1); g.clip();
  assert.equal(g.markCount, 2, 'a clip is not a mark');
});

test('painting an empty path emits nothing', () => {
  const g = S();
  g.beginPath(); g.fill(); g.stroke();
  assert.equal(g.markCount, 0);
});

test('the same drawing twice produces byte-identical documents', () => {
  const draw = (g) => {
    g.save();
    g.translate(3, 4); g.rotate(0.3); g.globalAlpha = 0.6;
    g.fillStyle = '#123456';
    g.beginPath(); g.arc(0, 0, 5, 0, Math.PI); g.closePath(); g.fill();
    g.restore();
  };
  const a = S(); draw(a);
  const b = S(); draw(b);
  assert.equal(a.toSVG(), b.toSVG());
});

test('toSVG is safe to call more than once', () => {
  const g = S();
  g.beginPath(); g.rect(0, 0, 1, 1); g.fill();
  assert.equal(g.toSVG(), g.toSVG());
});

// ---- the five accessors that existed without ever being exercised ----------
//
// Found by scanning every declared name for a reader: implemented, wired to
// real emission, and never once run. Unproven code is a liability whatever it
// looks like, and the answer for a Canvas2D-shaped surface is not to delete the
// shape -- a method that works on a canvas and throws on export is a divergence
// between two outputs the whole design exists to keep identical.

test('strokeRect is a rect and a stroke, so the live path and the vector path agree', () => {
  const a = S();
  a.strokeStyle = '#111';
  a.lineWidth = 3;
  a.strokeRect(10, 20, 30, 40);

  const b = S();
  b.strokeStyle = '#111';
  b.lineWidth = 3;
  b.beginPath(); b.rect(10, 20, 30, 40); b.stroke();

  assert.equal(a.toSVG(), b.toSVG());
  assert.match(a.toSVG(), /stroke="#111"/);
  assert.equal(a.markCount, 1);
});

test('resetTransform drops the whole transform stack back to identity', () => {
  const g = S();
  g.translate(40, 40);
  g.scale(3, 3);
  g.rotate(1);
  g.resetTransform();
  g.beginPath(); g.moveTo(7, 9); g.lineTo(11, 13); g.stroke();
  assert.equal(firstPathD(g.toSVG()), 'M7 9L11 13');
});

test('resetTransform does not survive a restore', () => {
  // It sets the CTM; it does not pop the stack. A caller that saved a transform
  // must still get it back, or save/restore means two different things.
  const g = S();
  g.save();
  g.translate(10, 10);
  g.resetTransform();
  g.restore();
  g.beginPath(); g.moveTo(0, 0); g.lineTo(1, 1); g.stroke();
  assert.equal(firstPathD(g.toSVG()), 'M0 0L1 1');
});

test('miterLimit reaches the document, and only where it can matter', () => {
  const on = S();
  on.lineJoin = 'miter';
  on.miterLimit = 2;
  on.beginPath(); on.moveTo(0, 0); on.lineTo(5, 0); on.lineTo(5, 5); on.stroke();
  assert.match(on.toSVG(), /stroke-miterlimit="2"/);
  assert.equal(on.miterLimit, 2, 'and it reads back');

  const dflt = S();
  dflt.beginPath(); dflt.moveTo(0, 0); dflt.lineTo(5, 0); dflt.stroke();
  assert.doesNotMatch(dflt.toSVG(), /stroke-miterlimit/, 'the default 10 is not written out');

  const round = S();
  round.lineJoin = 'round';
  round.miterLimit = 2;
  round.beginPath(); round.moveTo(0, 0); round.lineTo(5, 0); round.stroke();
  assert.doesNotMatch(round.toSVG(), /stroke-miterlimit/, 'nor is it written for a join that has no mitre');
});

test('a dash offset is written, and scales with the transform like the dashes do', () => {
  // A dash pattern is a LENGTH, so it must scale with the CTM or a dashed line
  // exported at print scale comes back with screen-sized dashes.
  const g = S();
  g.scale(4, 4);
  g.setLineDash([6, 2]);
  g.lineDashOffset = 3;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(10, 0); g.stroke();
  const svg = g.toSVG();
  assert.match(svg, /stroke-dasharray="24 8"/);
  assert.match(svg, /stroke-dashoffset="12"/);
});

test('an offset with no dash pattern writes nothing', () => {
  const g = S();
  g.lineDashOffset = 3;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(10, 0); g.stroke();
  assert.doesNotMatch(g.toSVG(), /stroke-dashoffset/);
});

test('getLineDash hands back a copy, so a caller cannot reach in and change it', () => {
  const g = S();
  g.setLineDash([4, 1]);
  const got = g.getLineDash();
  assert.deepEqual(got, [4, 1]);
  got[0] = 999;
  assert.deepEqual(g.getLineDash(), [4, 1]);

  const given = [7, 2];
  g.setLineDash(given);
  given[0] = 999;
  assert.deepEqual(g.getLineDash(), [7, 2], 'and it took a copy on the way in too');
});

test('setTransform REPLACES the transform where transform() multiplies it', () => {
  // Found by the unread-name lint after the other five: the page calls it on a
  // real canvas, so a piece may too, and a surface that lacks it would throw on
  // export from a piece that worked live.
  const replaced = S();
  replaced.scale(5, 5);
  replaced.setTransform(2, 0, 0, 2, 10, 10);
  replaced.beginPath(); replaced.moveTo(1, 1); replaced.lineTo(2, 2); replaced.stroke();
  assert.equal(firstPathD(replaced.toSVG()), 'M12 12L14 14');

  const multiplied = S();
  multiplied.scale(5, 5);
  multiplied.transform(2, 0, 0, 2, 10, 10);
  multiplied.beginPath(); multiplied.moveTo(1, 1); multiplied.lineTo(2, 2); multiplied.stroke();
  assert.equal(firstPathD(multiplied.toSVG()), 'M60 60L70 70', 'transform() composes with what was there');
});
