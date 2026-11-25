// A vector surface: a Canvas2D-shaped drawing target that emits SVG.
//
// WHY IT IS SHAPED LIKE CANVAS2D. Because the platform already has a drawing
// vocabulary and a piece written against it runs unchanged on a screen, in a
// frame sequence, at print scale and on a plotter. Inventing a second vocabulary
// would buy nothing and would have to be learned.
//
// WHAT IT REFUSES, AND WHY BY NAME. Raster operations cannot become paths. A
// vector surface that quietly skipped them would hand back a file missing half
// the picture. Every raster operation therefore throws, naming itself and
// saying what to do instead, and so does setting a composite mode, a filter or
// a shadow, which the paths cannot carry.
//
// THE ONE LIMIT WORTH STATING. Coordinates are baked into the current transform,
// which is exact for lines and Béziers (affine-invariant). Elliptical arcs use
// SVG A commands under similarities; other transforms keep cubic approximation.
// Stroke WIDTH is scaled by
// sqrt(|det|), so under a NON-UNIFORM scale a stroke that Canvas2D would draw
// anisotropically comes out uniform. Plotters and print do not want anisotropic
// strokes, so this is the right trade here -- but it is a difference, not a
// rounding.

'use strict';

const RASTER_ONLY = {
  drawImage: 'draw the geometry instead, draw an image under if (g.canvas) so the SVG keeps the marks alone, or declare outputs: ["raster"]',
  putImageData: 'a pixel buffer has no path; declare outputs: ["raster"]',
  getImageData: 'a vector surface has no pixels to read back',
  createImageData: 'a vector surface has no pixels',
  createPattern: 'repeat the geometry, or declare outputs: ["raster"]',
  fillText: 'use a stroke font that returns coordinates, so the letter composes '
          + 'with everything else that takes a path',
  strokeText: 'use a stroke font that returns coordinates',
  measureText: 'measure the stroke font\'s own advance widths',
  createConicGradient: 'SVG has no conic gradient; approximate it with geometry',
};

// Compositing, filters and shadows change how a mark meets the pixels under
// it, and the paths this surface writes carry none of them. A setter that
// kept 'multiply' and read it back would hand over an SVG that differs from
// its raster without a word. So each is taken only at the value that draws
// nothing different, and any other throws, naming the property. A number
// Canvas2D itself ignores (a negative or non-finite blur, a non-finite offset)
// is ignored here too. A string other than the one taken is refused, a typo
// included: this surface cannot tell a misspelt mode from one it cannot draw,
// and naming either is better than guessing. A blur or an offset is refused
// whatever the shadow's colour, so no setting order can reach a visible shadow;
// shadowColor alone is kept at any value, since with no blur and no offset
// Canvas2D draws no shadow whatever its colour. The state is only ever at its
// initial value, so a getter returns that and nothing is stored or scoped.
const RASTER_STATE = {
  globalCompositeOperation: {
    initial: 'source-over',
    take: (v) => v === 'source-over',
    hint: 'SVG paints each path over the last. Draw an overlap as its own shape in '
        + 'the colour it should have, or declare outputs: ["raster"]',
  },
  filter: {
    initial: 'none',
    take: (v) => v === 'none',
    hint: 'a filter works on pixels. Draw the softened or shifted geometry itself, '
        + 'or declare outputs: ["raster"]',
  },
  shadowBlur: {
    initial: 0,
    take: (v) => !(Number(v) > 0 && Number(v) < Infinity),
    hint: 'a blurred shadow is pixels, not a path. Draw the shadow as its own shape '
        + 'under the mark, or declare outputs: ["raster"]',
  },
  shadowOffsetX: {
    initial: 0,
    take: (v) => !(Number.isFinite(Number(v)) && Number(v) !== 0),
    hint: 'draw the shadow as its own shape, offset under the mark, or declare '
        + 'outputs: ["raster"]',
  },
  shadowOffsetY: {
    initial: 0,
    take: (v) => !(Number.isFinite(Number(v)) && Number(v) !== 0),
    hint: 'draw the shadow as its own shape, offset under the mark, or declare '
        + 'outputs: ["raster"]',
  },
};

/**
 * Trim a number for output: short enough to keep files small, exact enough to
 * plot.
 *
 * THE HOTTEST LINE IN THE WHOLE LIBRARY. Every coordinate of every point of
 * every path goes through here twice, and a profile of a piece with a 600 kB
 * document put 19.5% of the render inside this one function. It is worth the
 * three extra lines.
 *
 * What costs the time is turning a DOUBLE into a string: the engine has to
 * search for the shortest decimal that round-trips. Turning a small INTEGER into
 * a string does not -- and after rounding to four places the value is an
 * integer, scaled. So the string is assembled from that integer and the division
 * never happens.
 *
 * String(-0) is already "0" in JavaScript, so no negative-zero guard is needed
 * HERE, and an earlier one was dead code that no check could fail. That is a
 * fact about String(), not a general rule, and reading it as one cost this
 * project a bug: toFixed(6) renders -0 as "-0.000000", so the same pattern in a
 * coordinate KEY does need the guard. The `i === 0` line below keeps the same
 * promise for the same reason, explicitly rather than by luck.
 */
function n(v) {
  if (!Number.isFinite(v)) throw new Error(`vector surface: non-finite coordinate ${v}`);
  const i = Math.round(v * 1e4);
  if (i === 0) return '0';                                   // covers -0 without a special case
  if (i % 10000 === 0) return String(i / 10000);             // a whole number, which most are
  const neg = i < 0;
  const a = neg ? -i : i;
  const whole = (a / 10000) | 0;
  // Four digits, then the trailing zeros cut. padStart is on a string of at most
  // four characters, so it costs nothing worth measuring.
  let frac = String(a % 10000).padStart(4, '0');
  while (frac.charCodeAt(frac.length - 1) === 48) frac = frac.slice(0, -1);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Multiply 2x3 affine matrices: apply `m` then `o`. */
function mul(o, m) {
  return [
    o[0] * m[0] + o[2] * m[1],
    o[1] * m[0] + o[3] * m[1],
    o[0] * m[2] + o[2] * m[3],
    o[1] * m[2] + o[3] * m[3],
    o[0] * m[4] + o[2] * m[5] + o[4],
    o[1] * m[4] + o[3] * m[5] + o[5],
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Uniform scale factor of a matrix, for stroke width and dash lengths. */
function scaleOf(m) {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** Similarities preserve perpendicular equal-length axes, including reflection. */
function similarityOf(m) {
  const largest = Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]));
  if (!(largest > 0) || !Number.isFinite(largest)) return null;
  const a = m[0] / largest, b = m[1] / largest, c = m[2] / largest, d = m[3] / largest;
  const x = a * a + b * b, y = c * c + d * d;
  const tolerance = 32 * Number.EPSILON * Math.max(x, y);
  if (Math.abs(x - y) > tolerance || Math.abs(a * c + b * d) > tolerance) return null;
  return { scale: largest * Math.sqrt(x), reflected: a * d - b * c < 0 };
}

class Gradient {
  constructor(kind, coords) { this.kind = kind; this.coords = coords; this.stops = []; }
  addColorStop(offset, color) {
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) throw new Error('addColorStop: offset must be in [0,1]');
    this.stops.push([offset, String(color)]);
    return this;
  }
}

function initialState() {
  return {
    m: [1, 0, 0, 1, 0, 0],
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalAlpha: 1,
    lineDash: [],
    lineDashOffset: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
  };
}

class VectorSurface {
  /**
   * @param {{w:number,h:number}} size  the design box
   * @param {{background?:string, precision?:number}} [opt]
   */
  constructor(size, opt = {}) {
    if (!size || !Number.isFinite(size.w) || !Number.isFinite(size.h)) {
      throw new Error('VectorSurface: size must be { w, h }');
    }
    this.kind = 'vector';
    this.width = size.w;
    this.height = size.h;
    this._bg = opt.background || null;
    this._manifest = opt.manifest || null;

    this._body = [];
    this._defs = [];
    this._defId = 0;
    this._path = [];        // SVG path data, already in device space
    this._start = null;     // subpath start, user space
    this._cur = null;       // current point, user space
    this._open = 0;         // groups opened at this state level

    this._st = initialState();
    this._stack = [];

    for (const [op, hint] of Object.entries(RASTER_ONLY)) {
      this[op] = () => {
        throw new Error(`vector surface: ${op}() is a raster operation and has no path. ${hint}.`);
      };
    }
  }

  // ---- state -------------------------------------------------------------

  save() {
    this._stack.push({ st: Object.assign({}, this._st, { m: this._st.m.slice(), lineDash: this._st.lineDash.slice() }), open: this._open });
    this._open = 0;
    return this;
  }

  restore() {
    while (this._open > 0) { this._body.push('</g>'); this._open--; }
    const f = this._stack.pop();
    if (f) { this._st = f.st; this._open = f.open; }
    return this;
  }

  /**
   * What a canvas reset() does: the bitmap clears, so every mark, gradient and
   * clip group drawn so far is discarded, the save stack empties, the transform
   * and every style return to their defaults and the current path is dropped.
   * The SVG then holds the marks drawn after the reset, as the canvas does,
   * and still opens with the background rect when the background option is
   * set: that rect belongs to the export, not to the draw, so reset() keeps it.
   */
  reset() {
    this._body = [];
    this._defs = [];
    this._defId = 0;
    this._open = 0;
    this._stack = [];
    this._st = initialState();
    return this.beginPath();
  }

  // ---- transform ---------------------------------------------------------

  transform(a, b, c, d, e, f) { this._st.m = mul(this._st.m, [a, b, c, d, e, f]); return this; }
  setTransform(a, b, c, d, e, f) { this._st.m = [a, b, c, d, e, f]; return this; }
  resetTransform() { this._st.m = [1, 0, 0, 1, 0, 0]; return this; }
  translate(x, y) { return this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { return this.transform(x, 0, 0, y === undefined ? x : y, 0, 0); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); return this.transform(c, s, -s, c, 0, 0); }

  /** Independent numeric Canvas-shaped snapshot, without DOMMatrix methods. */
  getTransform() {
    const [a, b, c, d, e, f] = this._st.m;
    return { a, b, c, d, e, f };
  }

  // ---- path --------------------------------------------------------------

  beginPath() { this._path = []; this._start = null; this._cur = null; return this; }

  moveTo(x, y) {
    const [X, Y] = apply(this._st.m, x, y);
    this._path.push(`M${n(X)} ${n(Y)}`);
    this._start = [x, y];
    this._cur = [x, y];
    return this;
  }

  lineTo(x, y) {
    if (!this._cur) return this.moveTo(x, y);
    const [X, Y] = apply(this._st.m, x, y);
    this._path.push(`L${n(X)} ${n(Y)}`);
    this._cur = [x, y];
    return this;
  }

  bezierCurveTo(x1, y1, x2, y2, x, y) {
    if (!this._cur) this.moveTo(x1, y1);
    const m = this._st.m;
    const [a, b] = apply(m, x1, y1);
    const [c, d] = apply(m, x2, y2);
    const [e, f] = apply(m, x, y);
    this._path.push(`C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)}`);
    this._cur = [x, y];
    return this;
  }

  quadraticCurveTo(cx, cy, x, y) {
    if (!this._cur) this.moveTo(cx, cy);
    const [px, py] = this._cur;
    // Exact degree elevation, so the vector output is the same curve the raster
    // one draws rather than an approximation of it.
    return this.bezierCurveTo(
      px + (2 / 3) * (cx - px), py + (2 / 3) * (cy - py),
      x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y),
      x, y,
    );
  }

  closePath() {
    if (this._cur) { this._path.push('Z'); this._cur = this._start ? this._start.slice() : null; }
    return this;
  }

  rect(x, y, w, h) {
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h);
    return this.closePath();
  }

  roundRect(x, y, w, h, radii = 0) {
    // Present because hard-edged graphic work has no other way to make one, and
    // dropping to a raw rectangle costs it every stroke and fill treatment the
    // rest of the surface offers.
    let r = Array.isArray(radii) ? radii.slice() : [radii, radii, radii, radii];
    if (r.length === 1) r = [r[0], r[0], r[0], r[0]];
    if (r.length === 2) r = [r[0], r[1], r[0], r[1]];
    if (r.length === 3) r = [r[0], r[1], r[2], r[1]];
    const lim = Math.min(Math.abs(w), Math.abs(h)) / 2;
    r = r.map((v) => Math.max(0, Math.min(Number(v) || 0, lim)));
    const [tl, tr, br, bl] = r;
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y); if (tr) this.arcTo(x + w, y, x + w, y + tr, tr);
    this.lineTo(x + w, y + h - br); if (br) this.arcTo(x + w, y + h, x + w - br, y + h, br);
    this.lineTo(x + bl, y + h); if (bl) this.arcTo(x, y + h, x, y + h - bl, bl);
    this.lineTo(x, y + tl); if (tl) this.arcTo(x, y, x + tl, y, tl);
    return this.closePath();
  }

  arc(cx, cy, r, a0, a1, ccw = false) {
    return this.ellipse(cx, cy, r, r, 0, a0, a1, ccw);
  }

  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    // Similarities need only transformed radii, axis rotation and sweep. Other
    // affine transforms retain user-space cubics; the approximation transforms
    // exactly, although the cubic itself is not an exact ellipse.
    let d = a1 - a0;
    const TAU = Math.PI * 2;
    if (ccw) { if (d > 0) d -= TAU * Math.ceil(d / TAU); if (d <= -TAU) d = -TAU; }
    else { if (d < 0) d += TAU * Math.ceil(-d / TAU); if (d >= TAU) d = TAU; }
    // Distinct angles an integer turn apart still trace the circumference.
    // Only identical input angles describe an empty sweep.
    if (d === 0 && a1 !== a0) d = ccw ? -TAU : TAU;

    const cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (th) => {
      const x = rx * Math.cos(th), y = ry * Math.sin(th);
      return [cx + x * cr - y * sr, cy + x * sr + y * cr];
    };
    const D = (th) => {
      const x = -rx * Math.sin(th), y = ry * Math.cos(th);
      return [x * cr - y * sr, x * sr + y * cr];
    };

    const p0 = P(a0);
    if (!this._cur) this.moveTo(p0[0], p0[1]); else this.lineTo(p0[0], p0[1]);
    if (d === 0) return this;

    const m = this._st.m;
    const similarity = similarityOf(m);
    const hasRadii = similarity && rx > 0 && ry > 0;
    const arcRx = hasRadii ? n(rx * similarity.scale) : '0';
    const arcRy = hasRadii ? n(ry * similarity.scale) : '0';
    // A positive input radius can disappear at SVG serialization precision.
    // Keep cubics when either emitted radius is zero, preserving the visible axis.
    if (arcRx !== '0' && arcRy !== '0') {
      const rotation = Math.atan2(m[1] * cr + m[3] * sr, m[0] * cr + m[2] * sr) * 180 / Math.PI;
      const sweep = (d > 0) !== similarity.reflected ? 1 : 0;
      // SVG omits an arc with coincident endpoints. Split whole circles and
      // nearly whole turns whose endpoints coincide at serialization precision.
      let count = Math.abs(d) === TAU ? 2 : 1;
      if (count === 1 && Math.abs(d) > Math.PI) {
        const start = apply(m, ...p0).map(n);
        const end = apply(m, ...P(a0 + d)).map(n);
        if (start[0] === end[0] && start[1] === end[1]) count = 2;
      }
      const large = Math.abs(d / count) > Math.PI ? 1 : 0;
      const command = `A${arcRx} ${arcRy} ${n(rotation)} ${large} ${sweep} `;
      for (let i = 1; i <= count; i++) {
        const point = i === count && Math.abs(d) === TAU ? p0 : P(a0 + d * (i / count));
        const [x, y] = apply(m, ...point);
        this._path.push(`${command}${n(x)} ${n(y)}`);
        this._cur = point;
      }
      return this;
    }

    const segs = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 2)));
    const step = d / segs;
    const alpha = (4 / 3) * Math.tan(step / 4);
    let th = a0;
    for (let i = 0; i < segs; i++) {
      const th2 = th + step;
      const s = P(th), e = P(th2), ds = D(th), de = D(th2);
      this.bezierCurveTo(
        s[0] + alpha * ds[0], s[1] + alpha * ds[1],
        e[0] - alpha * de[0], e[1] - alpha * de[1],
        e[0], e[1],
      );
      th = th2;
    }
    return this;
  }

  arcTo(x1, y1, x2, y2, r) {
    if (!this._cur) return this.moveTo(x1, y1);
    if (!(r >= 0)) throw new Error('arcTo: radius must be non-negative');
    const [x0, y0] = this._cur;
    const a = [x0 - x1, y0 - y1];
    const b = [x2 - x1, y2 - y1];
    const la = Math.hypot(a[0], a[1]);
    const lb = Math.hypot(b[0], b[1]);
    if (la === 0 || lb === 0 || r === 0) return this.lineTo(x1, y1);
    const ua = [a[0] / la, a[1] / la];
    const ub = [b[0] / lb, b[1] / lb];
    const cosT = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]));
    if (cosT >= 1 - 1e-12 || cosT <= -1 + 1e-12) return this.lineTo(x1, y1); // collinear
    const theta = Math.acos(cosT);
    const tan = r / Math.tan(theta / 2);
    const t1 = [x1 + ua[0] * tan, y1 + ua[1] * tan];
    const t2 = [x1 + ub[0] * tan, y1 + ub[1] * tan];
    const bis = [ua[0] + ub[0], ua[1] + ub[1]];
    const lbis = Math.hypot(bis[0], bis[1]);
    const dc = r / Math.sin(theta / 2);
    const c = [x1 + (bis[0] / lbis) * dc, y1 + (bis[1] / lbis) * dc];
    const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    const a1 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    const cross = ua[0] * ub[1] - ua[1] * ub[0];
    this.lineTo(t1[0], t1[1]);
    return this.ellipse(c[0], c[1], r, r, 0, a0, a1, cross > 0);
  }

  // ---- gradients ---------------------------------------------------------

  createLinearGradient(x0, y0, x1, y1) { return new Gradient('linear', [x0, y0, x1, y1]); }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient('radial', [x0, y0, r0, x1, y1, r1]); }

  _paintRef(style) {
    if (!(style instanceof Gradient)) return esc(String(style));
    const id = `g${this._defId++}`;
    const m = this._st.m;
    // The gradient's coordinates are in USER space at paint time, and path
    // coordinates are baked into device space, so the CTM goes on the gradient.
    const gt = ` gradientTransform="matrix(${m.map(n).join(' ')})"`;
    const stops = style.stops
      .slice()
      .sort((p, q) => p[0] - q[0])
      .map(([o, c]) => `<stop offset="${n(o)}" stop-color="${esc(c)}"/>`)
      .join('');
    if (style.kind === 'linear') {
      const [x0, y0, x1, y1] = style.coords;
      this._defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}"${gt}>${stops}</linearGradient>`);
    } else {
      const [x0, y0, r0, x1, y1, r1] = style.coords;
      this._defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" fx="${n(x0)}" fy="${n(y0)}" fr="${n(r0)}" cx="${n(x1)}" cy="${n(y1)}" r="${n(r1)}"${gt}>${stops}</radialGradient>`);
    }
    return `url(#${id})`;
  }

  // ---- painting ----------------------------------------------------------

  get fillStyle() { return this._st.fillStyle; }
  set fillStyle(v) { this._st.fillStyle = v; }
  get strokeStyle() { return this._st.strokeStyle; }
  set strokeStyle(v) { this._st.strokeStyle = v; }
  get lineWidth() { return this._st.lineWidth; }
  set lineWidth(v) { this._st.lineWidth = v; }
  get lineCap() { return this._st.lineCap; }
  set lineCap(v) { this._st.lineCap = v; }
  get lineJoin() { return this._st.lineJoin; }
  set lineJoin(v) { this._st.lineJoin = v; }
  get miterLimit() { return this._st.miterLimit; }
  set miterLimit(v) { this._st.miterLimit = v; }
  get globalAlpha() { return this._st.globalAlpha; }
  set globalAlpha(v) { this._st.globalAlpha = v; }
  get lineDashOffset() { return this._st.lineDashOffset; }
  set lineDashOffset(v) { this._st.lineDashOffset = v; }
  get shadowColor() { return this._st.shadowColor; }
  set shadowColor(v) { this._st.shadowColor = v; }

  // As on a canvas: a list with a negative or non-finite entry is ignored, and
  // an odd-length list is stored doubled, so getLineDash reads back the same.
  setLineDash(a) {
    const d = Array.isArray(a) ? a.map(Number) : [];
    if (d.some((v) => !(v >= 0) || v === Infinity)) return this;
    this._st.lineDash = d.length % 2 ? d.concat(d) : d;
    return this;
  }
  getLineDash() { return this._st.lineDash.slice(); }

  fill(rule) {
    if (!this._path.length) return this;
    const a = this._st.globalAlpha;
    const attrs = [
      `d="${this._path.join('')}"`,
      `fill="${this._paintRef(this._st.fillStyle)}"`,
      rule === 'evenodd' ? 'fill-rule="evenodd"' : null,
      a < 1 ? `fill-opacity="${n(a)}"` : null,
    ].filter(Boolean);
    this._body.push(`<path ${attrs.join(' ')}/>`);
    return this;
  }

  stroke() {
    if (!this._path.length) return this;
    const st = this._st;
    const k = scaleOf(st.m);
    const a = st.globalAlpha;
    const attrs = [
      `d="${this._path.join('')}"`,
      'fill="none"',
      `stroke="${this._paintRef(st.strokeStyle)}"`,
      `stroke-width="${n(st.lineWidth * k)}"`,
      st.lineCap !== 'butt' ? `stroke-linecap="${esc(st.lineCap)}"` : null,
      st.lineJoin !== 'miter' ? `stroke-linejoin="${esc(st.lineJoin)}"` : null,
      st.lineJoin === 'miter' && st.miterLimit !== 10 ? `stroke-miterlimit="${n(st.miterLimit)}"` : null,
      st.lineDash.length ? `stroke-dasharray="${st.lineDash.map((v) => n(v * k)).join(' ')}"` : null,
      st.lineDash.length && st.lineDashOffset ? `stroke-dashoffset="${n(st.lineDashOffset * k)}"` : null,
      a < 1 ? `stroke-opacity="${n(a)}"` : null,
    ].filter(Boolean);
    this._body.push(`<path ${attrs.join(' ')}/>`);
    return this;
  }

  clip(rule) {
    if (!this._path.length) return this;
    const id = `c${this._defId++}`;
    this._defs.push(
      `<clipPath id="${id}"${rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}><path d="${this._path.join('')}"/></clipPath>`,
    );
    this._body.push(`<g clip-path="url(#${id})">`);
    this._open++;
    return this;
  }

  clearRect() {
    // Canvas2D clears to transparent. SVG has no eraser: a shape painted over
    // is still in the file, and a plotter would draw it. Saying so is better
    // than pretending it worked.
    throw new Error(
      'vector surface: clearRect() cannot erase -- SVG has no destination to '
      + 'clear, and a plotter would still draw whatever is underneath. Paint the '
      + 'ground first instead, or declare outputs: ["raster"].',
    );
  }

  fillRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); return this.fill(); }
  strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); return this.stroke(); }

  // ---- output ------------------------------------------------------------

  /** The finished document. Safe to call more than once. */
  /**
   * Record the recipe this document was drawn from. It is written into the
   * file's own <metadata>, so a plotter file or a print master that outlives
   * the session it came from still says how to make it again.
   */
  setManifest(m) { this._manifest = m; }

  toSVG() {
    const close = '</g>'.repeat(this._open + this._stack.reduce((s, f) => s + f.open, 0));
    const defs = this._defs.length ? `<defs>${this._defs.join('')}</defs>` : '';
    const bg = this._bg
      ? `<rect width="${n(this.width)}" height="${n(this.height)}" fill="${esc(this._bg)}"/>`
      : '';
    // JSON inside <metadata>, escaped like every other string that reaches this
    // document. A file someone kept and a file someone re-rendered have to be
    // the same file, and a picture with no recipe is the one that cannot be.
    const meta = this._manifest
      ? `<metadata id="artifex-manifest">${esc(JSON.stringify(this._manifest))}</metadata>`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.width)}" height="${n(this.height)}" `
      + `viewBox="0 0 ${n(this.width)} ${n(this.height)}">`
      + meta + defs + bg + this._body.join('') + close
      + '</svg>';
  }

  /** How many painted elements the document carries. A liveness floor for checks. */
  get markCount() { return this._body.filter((s) => s.startsWith('<path')).length; }
}

// On the prototype, beside the other style accessors. A value is either
// refused or leaves the state at its initial value, so the getter returns that.
function shown(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return String(v); } catch { return Object.prototype.toString.call(v); }
}

for (const [key, { initial, take, hint }] of Object.entries(RASTER_STATE)) {
  Object.defineProperty(VectorSurface.prototype, key, {
    configurable: true,
    get() { return initial; },
    set(v) {
      if (!take(v)) throw new Error(`vector surface: ${key} = ${shown(v)} is a raster operation and has no path. ${hint}.`);
    },
  });
}

/**
 * The recipe an SVG's <metadata id="artifex-manifest"> holds, as toSVG writes
 * it, or null for an SVG without one. Throws by name when it is not JSON.
 */
function svgManifest(svg) {
  const found = /<metadata id="artifex-manifest">([^<]*)<\/metadata>/.exec(svg);
  if (!found) return null;
  const text = found[1].replace(/&(amp|lt|gt|quot);/g, (_, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"' })[k]);
  try { return JSON.parse(text); } catch (e) { throw new Error(`the SVG's artifex-manifest metadata is not JSON: ${e.message}`); }
}

// ---- plotter pass --------------------------------------------------------
//
// A plotter draws every stroke in the file and travels pen-up between them in
// file order. plotSVG rewrites an SVG this surface wrote for that machine: it
// removes the stretches of stroke a later opaque fill fully covers, and orders
// strokes by nearest endpoint, per pen. It is a tool to call on a finished SVG,
// so an SVG that never goes through it is unchanged.
//
// WHAT IT WILL NOT MOVE. A stroke never crosses a fill or a clip group, because
// that would change what is on top of what. A dashed, translucent or gradient
// stroke stays whole and in place: cutting or reversing one changes its pattern
// or its overlap. Inside a run of strokes, grouping by pen does change which pen
// lies on top where two colours cross, which is what plotting in passes means.

const PLOT_STEP = 0.25;

/** True only for a colour that is provably opaque. */
function solidColour(c) {
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return true;
  const f = /^(?:rgb|hsl)a?\(([^)]*)\)$/i.exec(c);
  if (!f) return false;
  const v = f[1].trim().split(/[\s,/]+/);
  return v.length === 3 || (v.length === 4 && (v[3] === '1' || v[3] === '100%'));
}

function attrOf(tag, key) {
  const found = new RegExp(` ${key}="([^"]*)"`).exec(tag);
  return found ? found[1] : null;
}

/** Path data as subpaths. A command after Z starts a new one at the same point. */
function subpathsOf(d) {
  const subs = [];
  let sub = null;
  for (const [, c, args] of d.matchAll(/([MLCAZ])([^MLCAZ]*)/g)) {
    const a = args.trim() ? args.trim().split(/\s+/).map(Number) : [];
    if (c === 'M') { sub = { at: a, segs: [], closed: false }; subs.push(sub); continue; }
    if (sub.closed) { sub = { at: sub.at, segs: [], closed: false }; subs.push(sub); }
    if (c === 'Z') sub.closed = true; else sub.segs.push({ c, a });
  }
  return subs;
}

function writeSubpath(sub) {
  const segs = sub.segs.map((s) => s.c + s.a.map(n).join(' ')).join('');
  return `M${n(sub.at[0])} ${n(sub.at[1])}${segs}${sub.closed ? 'Z' : ''}`;
}

const endOf = (sub) => (sub.segs.length ? sub.segs[sub.segs.length - 1].a.slice(-2) : sub.at);

function reversedSubpath(sub) {
  const ends = [sub.at, ...sub.segs.map((s) => s.a.slice(-2))];
  const segs = [];
  for (let i = sub.segs.length - 1; i >= 0; i--) {
    const { c, a } = sub.segs[i];
    if (c === 'L') segs.push({ c, a: ends[i] });
    else if (c === 'C') segs.push({ c, a: [a[2], a[3], a[0], a[1], ...ends[i]] });
    else segs.push({ c, a: [a[0], a[1], a[2], a[3], 1 - a[4], ...ends[i]] });
  }
  return { at: ends[ends.length - 1], segs, closed: false };
}

/** Points along an SVG arc in endpoint form, past the start, every `step` or less. */
function arcPoints(p, [radiusX, radiusY, degrees, large, sweep, x, y], step) {
  let rx = Math.abs(radiusX), ry = Math.abs(radiusY);
  if (!(rx > 0 && ry > 0)) return [[x, y]];
  const phi = degrees * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi);
  const dx = (p[0] - x) / 2, dy = (p[1] - y) / 2;
  const px = c * dx + s * dy, py = -s * dx + c * dy;
  const over = Math.sqrt(px * px / (rx * rx) + py * py / (ry * ry));
  if (over > 1) { rx *= over; ry *= over; }
  const under = rx * rx * py * py + ry * ry * px * px;
  const ratio = (under > 0 ? Math.sqrt(Math.max(0, (rx * rx * ry * ry - under) / under)) : 0)
    * (large === sweep ? -1 : 1);
  const ox = ratio * rx * py / ry, oy = -ratio * ry * px / rx;
  const cx = c * ox - s * oy + (p[0] + x) / 2, cy = s * ox + c * oy + (p[1] + y) / 2;
  const from = Math.atan2((py - oy) / ry, (px - ox) / rx);
  let delta = Math.atan2((-py - oy) / ry, (-px - ox) / rx) - from;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  const count = Math.max(1, Math.ceil(Math.abs(delta) * Math.max(rx, ry) / step));
  const out = [];
  for (let i = 1; i < count; i++) {
    const t = from + delta * i / count, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cx + c * ex - s * ey, cy + s * ex + c * ey]);
  }
  out.push([x, y]);
  return out;
}

/** A subpath as points no further apart than `step`, a closed one back at its start. */
function flatten(sub, step) {
  const pts = [sub.at];
  let p = sub.at;
  const line = (to) => {
    const count = Math.max(1, Math.ceil(Math.hypot(to[0] - p[0], to[1] - p[1]) / step));
    for (let i = 1; i < count; i++) pts.push([p[0] + (to[0] - p[0]) * i / count, p[1] + (to[1] - p[1]) * i / count]);
    pts.push(to);
    p = to;
  };
  for (const { c, a } of sub.segs) {
    if (c === 'L') line(a);
    else if (c === 'A') { pts.push(...arcPoints(p, a, step)); p = a.slice(-2); }
    else {
      // A cubic's speed never exceeds three times its longest control leg.
      const leg = Math.max(Math.hypot(a[0] - p[0], a[1] - p[1]), Math.hypot(a[2] - a[0], a[3] - a[1]), Math.hypot(a[4] - a[2], a[5] - a[3]));
      const count = Math.max(1, Math.ceil(3 * leg / step));
      for (let i = 0; i < count; i++) {
        const t = (i + 1) / count, u = 1 - t;
        const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
        pts.push([w0 * p[0] + w1 * a[0] + w2 * a[2] + w3 * a[4], w0 * p[1] + w1 * a[1] + w2 * a[3] + w3 * a[5]]);
      }
      p = a.slice(-2);
    }
  }
  if (sub.closed) line(sub.at);
  return pts;
}

function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return total;
}

/** How far the painted stroke reaches from its centre line, caps and miters included. */
function strokeReach(tag, pts, closed) {
  let k = attrOf(tag, 'stroke-linecap') === 'square' ? Math.SQRT2 : 1;
  if (!attrOf(tag, 'stroke-linejoin')) {
    const limit = Number(attrOf(tag, 'stroke-miterlimit') || 10);
    const last = pts.length - 1;
    for (let i = closed ? 0 : 1; i < last; i++) {
      const a = pts[i === 0 ? last - 1 : i - 1], b = pts[i], c = pts[i + 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const size = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      if (!(size > 0)) continue;
      const half = Math.sqrt(Math.max(0, (1 + (ux * vx + uy * vy) / size) / 2));
      if (half > 0 && 1 / half <= limit) k = Math.max(k, 1 / half);
    }
  }
  return (Number(attrOf(tag, 'stroke-width')) / 2) * k;
}

function insideFill(fill, x, y) {
  let winding = 0, crossings = 0;
  for (const ring of fill.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      if ((ay > y) === (by > y)) continue;
      if (x < ax + (y - ay) * (bx - ax) / (by - ay)) { crossings++; winding += by > ay ? 1 : -1; }
    }
  }
  return fill.evenodd ? crossings % 2 === 1 : winding !== 0;
}

/** True when the disc of radius `need` around (x, y) lies inside the fill. */
function fillCovers(fill, x, y, need) {
  const [x0, y0, x1, y1] = fill.box;
  if (x < x0 + need || x > x1 - need || y < y0 + need || y > y1 - need) return false;
  if (!insideFill(fill, x, y)) return false;
  const squared = need * need;
  for (const ring of fill.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      const ex = bx - ax, ey = by - ay, size = ex * ex + ey * ey;
      const t = size > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / size)) : 0;
      const dx = ax + t * ex - x, dy = ay + t * ey - y;
      if (dx * dx + dy * dy < squared) return false;
    }
  }
  return true;
}

/** A grid of the opaque fills, so a sample reads only the fills near it. */
function fillIndex(fills, w, h) {
  const size = 64, cells = new Map();
  const cell = (v, span) => Math.max(0, Math.min(size - 1, Math.floor(v / span * size)));
  for (const fill of fills) {
    for (let cx = cell(fill.box[0], w); cx <= cell(fill.box[2], w); cx++) {
      for (let cy = cell(fill.box[1], h); cy <= cell(fill.box[3], h); cy++) {
        const key = cx * size + cy;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(fill);
      }
    }
  }
  return (x, y) => cells.get(cell(x, w) * size + cell(y, h)) || [];
}

/** The stretches of a subpath no later fill fully covers. */
function visibleParts(sub, tag, order, near) {
  const pts = flatten(sub, PLOT_STEP);
  if (pts.length < 2) return [sub];
  // A sample this far inside a fill proves both segments beside it are hidden:
  // they are at most one step long, and the fill's own outline is within half
  // a step of its true edge.
  const need = strokeReach(tag, pts, sub.closed) + 2 * PLOT_STEP;
  const covered = pts.map(([x, y]) => near(x, y).some((f) => f.order > order && fillCovers(f, x, y, need)));
  if (!covered.includes(true)) return [sub];
  const runs = [];
  let run = null;
  for (let i = 0; i < pts.length - 1; i++) {
    if (covered[i] || covered[i + 1]) { run = null; continue; }
    if (!run) { run = [pts[i]]; runs.push(run); }
    run.push(pts[i + 1]);
  }
  if (!runs.length) return [];
  // A closed outline cut twice is one stretch across its seam.
  if (sub.closed && runs.length > 1 && !covered[0] && !covered[1] && !covered[pts.length - 2]) {
    runs[0] = [...runs.pop(), ...runs[0].slice(1)];
  }
  return runs.map((r) => ({ at: r[0], segs: r.slice(1).map((a) => ({ c: 'L', a })), closed: false }));
}

/** Walk one pen at a time from the origin, adding up the pen-up distance. */
function plotFigures(strokes) {
  const at = new Map();
  let penUp = 0, count = 0, length = 0;
  for (const { pen, sub } of strokes) {
    const [x, y] = at.get(pen) || [0, 0];
    penUp += Math.hypot(sub.at[0] - x, sub.at[1] - y);
    at.set(pen, sub.closed ? sub.at : endOf(sub));
    count++;
    length += polylineLength(flatten(sub, PLOT_STEP));
  }
  return { penUp, strokes: count, length };
}

/** Order one run of strokes: pen by pen, each next stroke the nearest endpoint. */
function orderRun(run, at) {
  const pens = new Map();
  for (const item of run) {
    if (!pens.has(item.pen)) pens.set(item.pen, []);
    pens.get(item.pen).push(item);
  }
  const out = [];
  for (const [pen, left] of pens) {
    let [x, y] = at.get(pen) || [0, 0];
    while (left.length) {
      let best = 0, flip = false, nearest = Infinity;
      for (let i = 0; i < left.length; i++) {
        const { sub } = left[i];
        const from = (sub.at[0] - x) ** 2 + (sub.at[1] - y) ** 2;
        if (from < nearest) { nearest = from; best = i; flip = false; }
        if (sub.closed) continue;
        const [ex, ey] = endOf(sub);
        const back = (ex - x) ** 2 + (ey - y) ** 2;
        if (back < nearest) { nearest = back; best = i; flip = true; }
      }
      const item = left[best];
      left[best] = left[left.length - 1];
      left.pop();
      const sub = flip ? reversedSubpath(item.sub) : item.sub;
      out.push({ ...item, sub });
      [x, y] = sub.closed ? sub.at : endOf(sub);
    }
    at.set(pen, [x, y]);
  }
  return out;
}

/**
 * Rewrite an SVG this surface wrote for a pen plotter. Returns `{ svg, before,
 * after }`, each figure holding `penUp` (distance travelled with the pen up, per
 * pen, from the origin), `strokes` (pen-down subpaths) and `length` (drawn).
 */
function plotSVG(svg) {
  const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!size) throw new Error('plotSVG: this is not an SVG a vector surface wrote; it has no viewBox');
  const defsEnd = svg.indexOf('</defs>'), metaEnd = svg.indexOf('</metadata>');
  const bodyAt = defsEnd >= 0 ? defsEnd + 7 : metaEnd >= 0 ? metaEnd + 11 : svg.indexOf('>') + 1;
  const tokens = [...svg.slice(bodyAt).matchAll(/<path [^>]*\/>|<g clip-path="[^"]*">|<\/g>/g)];

  const fills = [];
  let depth = 0;
  tokens.forEach(({ 0: tag }, order) => {
    if (tag === '</g>') depth--;
    else if (tag.startsWith('<g')) depth++;
    else if (depth === 0 && attrOf(tag, 'fill') !== 'none' && !attrOf(tag, 'fill-opacity') && solidColour(attrOf(tag, 'fill'))) {
      const rings = subpathsOf(attrOf(tag, 'd')).map((sub) => flatten(sub, PLOT_STEP));
      const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
      let box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < xs.length; i++) {
        box = [Math.min(box[0], xs[i]), Math.min(box[1], ys[i]), Math.max(box[2], xs[i]), Math.max(box[3], ys[i])];
      }
      fills.push({ order, rings, box, evenodd: attrOf(tag, 'fill-rule') === 'evenodd' });
    }
  });
  const near = fillIndex(fills, Number(size[1]), Number(size[2]));

  const out = [], before = [], after = [], at = new Map();
  let run = [], copied = bodyAt;
  const flush = () => {
    for (const item of orderRun(run, at)) {
      out.push(item.tag.replace(/ d="[^"]*"/, ` d="${writeSubpath(item.sub)}"`));
      after.push(item);
    }
    run = [];
  };
  tokens.forEach((token, order) => {
    const tag = token[0], start = bodyAt + token.index;
    if (start > copied) { flush(); out.push(svg.slice(copied, start)); }
    copied = start + tag.length;
    const pen = tag.startsWith('<path') && attrOf(tag, 'fill') === 'none' ? attrOf(tag, 'stroke') : null;
    if (pen === null) { flush(); out.push(tag); return; }
    const subs = subpathsOf(attrOf(tag, 'd'));
    for (const sub of subs) before.push({ pen, sub });
    if (!solidColour(pen) || attrOf(tag, 'stroke-opacity') || attrOf(tag, 'stroke-dasharray')) {
      flush();
      out.push(tag);
      for (const sub of subs) {
        after.push({ pen, sub });
        at.set(pen, sub.closed ? sub.at : endOf(sub));
      }
      return;
    }
    for (const sub of subs) {
      for (const part of visibleParts(sub, tag, order, near)) run.push({ pen, tag, sub: part });
    }
  });
  flush();
  out.push(svg.slice(copied));
  return { svg: svg.slice(0, bodyAt) + out.join(''), before: plotFigures(before), after: plotFigures(after) };
}

module.exports = { VectorSurface, RASTER_ONLY, svgManifest, plotSVG };
