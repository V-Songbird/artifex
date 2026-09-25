// The three mirrors bowed into circles, and the world seen in them. A circle
// mirror reflects by inversion: a point at distance d from its centre goes to
// the point on the same ray at r² / d.
//
// PINNED AT THE CORNERS. Each mirror stays fixed at the triangle's two corners
// and bows inwards between them, an arc of a circle through both. Straight,
// the three make the wallpaper *333; as they bow, the angles at the corners
// close from sixty degrees towards nothing, the kaleidoscope turns hyperbolic,
// and the reflections nest without end towards one circle, the circle that
// crosses all three mirrors square: the tiling of Escher's Circle Limit, made
// of the torn painting. Outside that circle is the same tiling turned inside
// out, since inversion in it maps the mirrors to themselves. While the angles
// are not a whole fraction of a half turn, the mirrors' images do not close
// up, as in any kaleidoscope, and the reflections meet along seams.
//
// PIXEL BY PIXEL. An inversion is not an affine map, so no copy of the scene
// can be laid down to show it. Each pixel is folded, inversion by inversion,
// into the region between the mirrors, and takes the colour of the scene
// where it comes to rest, a little darker for every reflection. Towards the
// limit circle the images grow smaller than a pixel, so past a few
// reflections a pixel takes the painting's mean tone more and more, and past
// DEPTH it is not folded further: what it would show averages out. That is done
// at under a third of the canvas's resolution (GRID), from a copy of the lifted scene read
// once at half the design's resolution, and laid back smoothed; the region
// between the mirrors is the scene itself, left to its kept copy at full
// resolution. The canvas is expected to be drawn with a plain scale, as the
// stage and the page's exports draw.

'use strict';

const P = require('./paper.js');

const GRID = 3.6;     // canvas pixels per folded pixel, each way
const DEPTH = 10;     // inversions at most, for points that fall towards the nesting
const BLUR = 7;       // and from this many, the painting's mean tone blended in
const GLASS = 4.5;    // a mirror's thickness, seen from above (as kaleido.js)
const HEIGHT = 26;    // how far its shadow falls

/**
 * The mirrors bowed by `bow` (0: straight; 1: their angles closed to
 * nothing) and turned by `turn` radians about the triangle's centre, as
 * circles [x, y, r], one per side of the triangle in its order, each with the
 * side's two corners as `ends`; and the circle they all cross square, as
 * `limit` [x, y, r].
 */
function circles(s, bow, turn = 0) {
  const t = s.triangle, side = s.params.side;
  const gx = (t[0][0] + t[1][0] + t[2][0]) / 3, gy = (t[0][1] + t[1][1] + t[2][1]) / 3;
  // Each arc turns by `half` from its chord at either end.
  const half = (Math.max(1e-6, bow) * Math.PI) / 6;
  const r = side / 2 / Math.sin(half), off = r * Math.cos(half);
  const c = Math.cos(turn), sn = Math.sin(turn);
  const at = (x, y) => [gx + (x - gx) * c - (y - gy) * sn, gy + (x - gx) * sn + (y - gy) * c];
  const cs = [0, 1, 2].map((i) => {
    const a = t[i], b = t[(i + 1) % 3];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, l = Math.hypot(mx - gx, my - gy);
    const circle = [...at(mx + ((mx - gx) / l) * off, my + ((my - gy) / l) * off), r];
    circle.ends = [at(a[0], a[1]), at(b[0], b[1])];
    return circle;
  });
  // By symmetry the three circles' powers at the centre are equal: the limit circle's radius squared.
  const power = (cs[0][0] - gx) ** 2 + (cs[0][1] - gy) ** 2 - r * r;
  cs.limit = [gx, gy, Math.sqrt(power)];
  return cs;
}

// The scene's colours, read once per solve.
const textures = new WeakMap();

/** The scene `paint(g, s)` draws, as RGBA words at half the design's resolution, or null where no canvas can be made. */
function texture(s, paint) {
  let tex = textures.get(s);
  if (tex) return tex;
  const w = P.W / 2, h = P.H / 2;
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : null;
  if (!c) return null;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(0.5, 0, 0, 0.5, 0, 0);
  paint(g, s);
  const data = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
  let r = 0, gr = 0, b = 0;
  for (const c of data) { r += c & 255; gr += (c >>> 8) & 255; b += (c >>> 16) & 255; }
  const n = data.length;
  tex = { w, h, data, mean: [r / n, gr / n, b / n] };
  textures.set(s, tex);
  return tex;
}

// One folded image per grid size, shared by every surface of that size.
const grids = new Map();

/**
 * Lay the reflections in the circles `cs` over the surface: every pixel
 * outside the region between the mirrors folded into it and coloured from
 * `tex`, darkened by `absorb` for each reflection; every pixel in it left as
 * it is. With `smooth`, the colours are read between the scene's pixels, for
 * a view close enough that each of them spans several of the surface's. With
 * `hole`, a circle's index, the reflection in that circle alone of the region
 * between the mirrors is laid only `through` opaque (0 to 1), for a caller
 * that draws it itself underneath.
 */
function reflect(g, cs, absorb, tex, smooth = false, hole = -1, through = 0) {
  const clear = Math.round(255 * through) << 24;
  const c = g.canvas, m = g.getTransform();
  const W = Math.ceil(c.width / GRID), H = Math.ceil(c.height / GRID);
  const key = W + 'x' + H;
  let grid = grids.get(key);
  if (!grid) {
    const canvas = new OffscreenCanvas(W, H);
    const img = new ImageData(W, H);
    grid = { canvas, g: canvas.getContext('2d'), img, px: new Uint32Array(img.data.buffer) };
    grids.set(key, grid);
  }
  const px = grid.px, data = tex.data, tw = tex.w, th = tex.h;
  // Per number of reflections: what is left of the light, and how much of the mean tone.
  const fall = new Uint16Array(DEPTH + 1), mix = new Uint16Array(DEPTH + 1);
  for (let n = 0; n <= DEPTH; n++) {
    fall[n] = Math.round(256 * Math.pow(1 - absorb, n));
    mix[n] = Math.round(256 * Math.max(0, Math.min(1, (n - BLUR) / (DEPTH - BLUR))));
  }
  const [mr, mg, mb] = tex.mean;
  const [[ax, ay, ar], [bx, by, br], [qx, qy, qr]] = cs;
  const aa = ar * ar, bb = br * br, qq = qr * qr;
  const [lx, ly, lr] = cs.limit, ll = lr * lr;
  const sx = GRID / m.a, sy = GRID / m.d, ox = -m.e / m.a, oy = -m.f / m.d;
  for (let y = 0, i = 0; y < H; y++) {
    const Y0 = oy + (y + 0.5) * sy;
    for (let x = 0; x < W; x++, i++) {
      let X = ox + (x + 0.5) * sx, Y = Y0, n = 0;
      // Outside the limit circle: the tiling turned inside out.
      const ex = X - lx, ey = Y - ly, e2 = ex * ex + ey * ey;
      const turned = e2 > ll;
      if (turned) { const q = ll / e2; X = lx + ex * q; Y = ly + ey * q; n = 1; }
      // A point just inverted in a circle is outside it: that circle is not tried next.
      let last = -1;
      while (n < DEPTH) {
        let dx, dy, d2;
        if (last !== 0) {
          dx = X - ax; dy = Y - ay; d2 = dx * dx + dy * dy;
          if (d2 < aa) { const q = aa / d2; X = ax + dx * q; Y = ay + dy * q; n++; last = 0; continue; }
        }
        if (last !== 1) {
          dx = X - bx; dy = Y - by; d2 = dx * dx + dy * dy;
          if (d2 < bb) { const q = bb / d2; X = bx + dx * q; Y = by + dy * q; n++; last = 1; continue; }
        }
        if (last !== 2) {
          dx = X - qx; dy = Y - qy; d2 = dx * dx + dy * dy;
          if (d2 < qq) { const q = qq / d2; X = qx + dx * q; Y = qy + dy * q; n++; last = 2; continue; }
        }
        break;
      }
      const own = n === 1 && last === hole && !turned;
      if (n === 0 || (own && !clear)) { px[i] = 0; continue; }
      const alpha = own ? clear : 0xff000000;
      let col;
      if (smooth) {
        const fx = Math.min(tw - 1.001, Math.max(0, X * 0.5 - 0.5)), fy = Math.min(th - 1.001, Math.max(0, Y * 0.5 - 0.5));
        const u = fx | 0, v = fy | 0, du = fx - u, dv = fy - v, o = v * tw + u;
        const c00 = data[o], c10 = data[o + 1], c01 = data[o + tw], c11 = data[o + tw + 1];
        const w00 = (1 - du) * (1 - dv), w10 = du * (1 - dv), w01 = (1 - du) * dv, w11 = du * dv;
        const ch = (sh) => (((c00 >>> sh) & 255) * w00 + ((c10 >>> sh) & 255) * w10 + ((c01 >>> sh) & 255) * w01 + ((c11 >>> sh) & 255) * w11) | 0;
        col = 0xff000000 | (ch(16) << 16) | (ch(8) << 8) | ch(0);
      } else {
        let u = (X * 0.5) | 0, v = (Y * 0.5) | 0;
        if (u < 0) u = 0; else if (u >= tw) u = tw - 1;
        if (v < 0) v = 0; else if (v >= th) v = th - 1;
        col = data[v * tw + u];
      }
      const f = fall[n], k = mix[n];
      if (f === 256 && k === 0) { px[i] = own ? (col & 0xffffff) | alpha : col; continue; }
      let R = col & 255, G = (col >>> 8) & 255, B = (col >>> 16) & 255;
      if (k) { R += ((mr - R) * k) / 256; G += ((mg - G) * k) / 256; B += ((mb - B) * k) / 256; }
      px[i] = alpha | (((B * f) >> 8) << 16) | (((G * f) >> 8) << 8) | ((R * f) >> 8);
    }
  }
  grid.g.putImageData(grid.img, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(grid.canvas, 0, 0, W, H, 0, 0, W * GRID, H * GRID);
  g.restore();
}

/**
 * Add to the path the image in circle `c` of the segment from `a` to `b`:
 * an arc of the circle through `c`'s centre that the segment's line goes to.
 */
function arcOf(g, c, a, b) {
  const [cx, cy, r] = c, ux = b[0] - a[0], uy = b[1] - a[1], l = Math.hypot(ux, uy);
  const t = ((cx - a[0]) * ux + (cy - a[1]) * uy) / (l * l);
  const fx = a[0] + ux * t - cx, fy = a[1] + uy * t - cy, d2 = fx * fx + fy * fy;
  const p = invert(c, a), q = invert(c, b);
  g.moveTo(p[0], p[1]);
  if (d2 < 1e-9) { g.lineTo(q[0], q[1]); return; }
  // Its centre is halfway from c's centre to the image of the line's nearest point.
  const k = (r * r) / (2 * d2), ox = cx + fx * k, oy = cy + fy * k, radius = (r * r) / (2 * Math.sqrt(d2));
  const turn = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a0 = Math.atan2(p[1] - oy, p[0] - ox), a1 = Math.atan2(q[1] - oy, q[0] - ox), ac = Math.atan2(cy - oy, cx - ox);
  // The way round that does not pass the centre, the image of the line's far ends.
  g.arc(ox, oy, radius, a0, a1, turn(ac - a0) < turn(a1 - a0));
}

/** Point `p` inverted in circle `c` [x, y, r]. */
function invert(c, p) {
  const dx = p[0] - c[0], dy = p[1] - c[1], q = (c[2] * c[2]) / (dx * dx + dy * dy);
  return [c[0] + dx * q, c[1] + dy * q];
}

/** The region between the mirrors, as a polygon along their arcs. */
function domain(cs) {
  return rims(cs).flatMap((line) => line.slice(1).map((p) => [p[0], p[1]]));
}

/**
 * Each mirror as a polyline from corner to corner along its arc:
 * [[x, y, nx, ny], ...] with the normal pointing away from the triangle.
 */
function rims(cs) {
  return cs.map(([cx, cy, r], i) => {
    const [a, b] = cs[i].ends;
    let a0 = Math.atan2(a[1] - cy, a[0] - cx), a1 = Math.atan2(b[1] - cy, b[0] - cx);
    // The short way round: the arc that bows into the triangle.
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
    const n = Math.max(2, Math.min(240, Math.ceil((Math.abs(a1 - a0) * Math.min(r, 1e7)) / 6)));
    const line = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      // Far from its centre an arc is a line to within a hair: laid as the chord, for precision.
      const x = r > 1e5 ? a[0] + (b[0] - a[0]) * u : cx + r * Math.cos(a0 + (a1 - a0) * u);
      const y = r > 1e5 ? a[1] + (b[1] - a[1]) * u : cy + r * Math.sin(a0 + (a1 - a0) * u);
      const d = Math.hypot(cx - x, cy - y);
      line.push([x, y, (cx - x) / d, (cy - y) / d]);
    }
    line.circle = i;
    return line;
  });
}

/**
 * The bowed mirrors at second `sec` of the mirrors' own clock: glass seen
 * end on, as the straight mirrors were, with the silvering behind, the edge
 * that faces the light lit, the shadow each casts and the light it throws
 * back (weakening as the mirror curves and spreads it), and a glint running
 * along each. `bow` is how far they have bowed. With `view`, [x0, y0, x1,
 * y1], a mirror nowhere near it is left out.
 */
function drawRims(g, s, cs, sec, bow, soft, view = null) {
  const lx = Math.cos(s.light), ly = Math.sin(s.light);
  const near = HEIGHT + GLASS;
  const lines = rims(cs).filter((line) => !view || line.some(([x, y]) => x > view[0] - near && x < view[2] + near && y > view[1] - near && y < view[3] + near));
  if (!lines.length) return;
  g.save();
  const thrown = 0.22 * (1 - bow) * (1 - bow);
  soft(g, 3, (sg) => {
    sg.fillStyle = 'rgba(10, 8, 6, 0.42)';
    sg.beginPath();
    for (const line of lines) band(sg, line, () => [-lx * HEIGHT, -ly * HEIGHT]);
    sg.fill();
    if (thrown > 0.005) {
      sg.fillStyle = 'rgba(255, 251, 238, ' + thrown.toFixed(3) + ')';
      sg.beginPath();
      for (const line of lines) {
        band(sg, line, (p) => {
          const d = 2 * (-lx * p[2] - ly * p[3]) * HEIGHT;
          return [-lx * HEIGHT - d * p[2], -ly * HEIGHT - d * p[3]];
        });
      }
      sg.fill();
    }
  });
  g.lineJoin = 'round';
  g.lineCap = 'butt';
  const h = GLASS / 2;
  stroke(g, lines, 0, 'rgba(176, 196, 188, 0.92)', GLASS);
  stroke(g, lines, h - 0.5, 'rgba(34, 38, 38, 0.9)', 1.1);
  // The lit edge: on the disc's side where that side faces the light, else on the other.
  const lit = [];
  for (const line of lines) {
    let run = null;
    for (const p of line) {
      const side = p[2] * lx + p[3] * ly > 0 ? 1 : -1;
      if (!run || run.side !== side) { run = []; run.side = side; lit.push(run); }
      run.push([p[0] + p[2] * side * (h - 0.45), p[1] + p[3] * side * (h - 0.45)]);
    }
  }
  g.strokeStyle = 'rgba(252, 255, 253, 0.95)';
  g.lineWidth = 0.9;
  g.beginPath();
  for (const run of lit) polyline(g, run);
  g.stroke();
  // A glint running along each rim, as along the straight mirrors.
  g.strokeStyle = 'rgba(255, 255, 252, 0.9)';
  g.lineWidth = 2;
  g.beginPath();
  for (const line of lines) {
    const mr = s.mirrors[line.circle];
    const lengths = [0];
    for (let k = 1; k < line.length; k++) lengths.push(lengths[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
    const len = lengths[lengths.length - 1];
    const at = (((sec - mr.t1) * 140 + mr.from * 97) % (len + 200)) - 100;
    const run = [];
    for (let k = 0; k < line.length; k++) {
      if (lengths[k] < at - 30 || lengths[k] > at + 30) continue;
      const p = line[k], side = p[2] * lx + p[3] * ly > 0 ? 1 : -1;
      run.push([p[0] + p[2] * side * (h - 0.45), p[1] + p[3] * side * (h - 0.45)]);
    }
    if (run.length > 1) polyline(g, run);
  }
  g.stroke();
  g.restore();
}

/** The band from a rim to the rim moved by `by(p)` at each point. */
function band(g, line, by) {
  g.moveTo(line[0][0], line[0][1]);
  for (let k = 1; k < line.length; k++) g.lineTo(line[k][0], line[k][1]);
  for (let k = line.length - 1; k >= 0; k--) {
    const [dx, dy] = by(line[k]);
    g.lineTo(line[k][0] + dx, line[k][1] + dy);
  }
  g.closePath();
}

/** Every rim, moved `off` into its disc, stroked. */
function stroke(g, lines, off, colour, width) {
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.beginPath();
  for (const line of lines) polyline(g, line.map((p) => [p[0] + p[2] * off, p[1] + p[3] * off]));
  g.stroke();
}

function polyline(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
}

module.exports = { circles, texture, reflect, invert, arcOf, domain, drawRims };
