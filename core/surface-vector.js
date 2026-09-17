// A vector surface: a Canvas2D-shaped drawing target that emits SVG.
//
// WHY THIS EXISTS. The engine this project imports from can reach a screen and
// nothing else -- every output path in it terminates at canvas.toDataURL. A
// repo-wide search for svg/plotter/hpgl/vpype in four months of work returns UI
// glyphs, one MIME entry, and three places documenting the absence. The data was
// always there (paths, contours and the stroke font all hand back polylines);
// the emitter was not.
//
// WHY IT IS SHAPED LIKE CANVAS2D. Because the platform already has a drawing
// vocabulary and a piece written against it runs unchanged on a screen, in a
// frame sequence, at print scale and on a plotter. Inventing a second vocabulary
// would buy nothing and would have to be learned.
//
// WHAT IT REFUSES, AND WHY BY NAME. Raster operations cannot become paths. A
// vector surface that quietly skipped them would hand back a file missing half
// the picture -- which is the failure this project has already paid for once,
// when a straight run fell below a station minimum and a letter lost its
// crossbar with no error anywhere. So every raster operation throws, naming
// itself and saying what to do instead.
//
// THE ONE LIMIT WORTH STATING. Coordinates are baked into the current transform,
// which is exact for lines and Béziers (affine-invariant) and for arcs (they are
// converted to Béziers in user space first). Stroke WIDTH is scaled by
// sqrt(|det|), so under a NON-UNIFORM scale a stroke that Canvas2D would draw
// anisotropically comes out uniform. Plotters and print do not want anisotropic
// strokes, so this is the right trade here -- but it is a difference, not a
// rounding.

'use strict';

const RASTER_ONLY = {
  drawImage: 'draw the geometry instead, or declare outputs: ["raster"]',
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

/** Trim a number for output: short enough to keep files small, exact enough to plot. */
function n(v) {
  if (!Number.isFinite(v)) throw new Error(`vector surface: non-finite coordinate ${v}`);
  // String(-0) is already "0" in JavaScript, so no negative-zero guard is needed
  // HERE, and an earlier one was dead code that no check could fail.
  //
  // That is a fact about String(), not a general rule, and reading it as one
  // cost this project a bug: toFixed(6) renders -0 as "-0.000000", so the same
  // pattern in a coordinate KEY does need the guard. See examples/contours.js.
  // Math.round below returns -0 for a small negative input, and String turns it
  // into "0" -- which is why this line is safe and that one was not.
  return String(Math.round(v * 1e4) / 1e4);
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

class Gradient {
  constructor(kind, coords) { this.kind = kind; this.coords = coords; this.stops = []; }
  addColorStop(offset, color) {
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) throw new Error('addColorStop: offset must be in [0,1]');
    this.stops.push([offset, String(color)]);
    return this;
  }
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

    this._body = [];
    this._defs = [];
    this._defId = 0;
    this._path = [];        // SVG path data, already in device space
    this._start = null;     // subpath start, user space
    this._cur = null;       // current point, user space
    this._open = 0;         // groups opened at this state level

    this._st = {
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
    };
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

  // ---- transform ---------------------------------------------------------

  transform(a, b, c, d, e, f) { this._st.m = mul(this._st.m, [a, b, c, d, e, f]); return this; }
  setTransform(a, b, c, d, e, f) { this._st.m = [a, b, c, d, e, f]; return this; }
  resetTransform() { this._st.m = [1, 0, 0, 1, 0, 0]; return this; }
  translate(x, y) { return this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { return this.transform(x, 0, 0, y === undefined ? x : y, 0, 0); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); return this.transform(c, s, -s, c, 0, 0); }

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
    // rest of the surface offers. See docs/subject-neutrality.md §2, gap 2.
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
    // Flattened to cubics IN USER SPACE, then transformed. Béziers are
    // affine-invariant, so the result is exact under any transform -- including
    // the non-uniform and sheared ones an SVG arc command cannot express.
    let d = a1 - a0;
    const TAU = Math.PI * 2;
    if (ccw) { if (d > 0) d -= TAU * Math.ceil(d / TAU); if (d <= -TAU) d = -TAU; }
    else { if (d < 0) d += TAU * Math.ceil(-d / TAU); if (d >= TAU) d = TAU; }

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

  setLineDash(a) { this._st.lineDash = Array.isArray(a) ? a.slice() : []; return this; }
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
  toSVG() {
    const close = '</g>'.repeat(this._open + this._stack.reduce((s, f) => s + f.open, 0));
    const defs = this._defs.length ? `<defs>${this._defs.join('')}</defs>` : '';
    const bg = this._bg
      ? `<rect width="${n(this.width)}" height="${n(this.height)}" fill="${esc(this._bg)}"/>`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.width)}" height="${n(this.height)}" `
      + `viewBox="0 0 ${n(this.width)} ${n(this.height)}">`
      + defs + bg + this._body.join('') + close
      + '</svg>';
  }

  /** How many painted elements the document carries. A liveness floor for checks. */
  get markCount() { return this._body.filter((s) => s.startsWith('<path')).length; }
}

module.exports = { VectorSurface, RASTER_ONLY };
