'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { VectorSurface, RASTER_ONLY } = require('../core/surface-vector.js');

// ---- helpers: read the emitted path back, so geometry claims are measured ----

function parsePath(d) {
  const out = [];
  const re = /([MLCZ])([^MLCZ]*)/g;
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

test('a full arc approximates a circle to better than 3e-4 of its radius', () => {
  const g = S();
  g.beginPath(); g.arc(50, 50, 40, 0, Math.PI * 2); g.stroke();
  const pts = samplePoints(firstPathD(g.toSVG()), 64);
  let worst = 0;
  for (const [x, y] of pts) worst = Math.max(worst, Math.abs(Math.hypot(x - 50, y - 50) - 40) / 40);
  assert.ok(worst < 3e-4, `worst radial error ${worst}`);
  assert.ok(pts.length > 200);
});

test('an arc under a NON-UNIFORM scale becomes a real ellipse', () => {
  // This is why arcs are flattened to Béziers in user space before the
  // transform: an SVG arc command could not express this, and baking a circle
  // would give the wrong silhouette.
  const g = S();
  g.scale(2, 1);
  g.beginPath(); g.arc(10, 10, 1, 0, Math.PI * 2); g.stroke();
  const b = bbox(samplePoints(firstPathD(g.toSVG()), 64));
  assert.ok(Math.abs((b.x1 - b.x0) - 4) < 2e-3, `width ${b.x1 - b.x0}`);
  assert.ok(Math.abs((b.y1 - b.y0) - 2) < 2e-3, `height ${b.y1 - b.y0}`);
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
