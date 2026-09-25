// The kaleidoscope the torn sheet is turned into: the pieces lift off the
// table, three mirror strips stand on the sheet round an equilateral triangle,
// and the light between them fills the frame with reflections.
//
// THE GROUP IS THE MIRRORS. Three mirrors at sixty degrees to each other
// generate the wallpaper group *333: every cell of a triangular lattice holds
// the triangle between the mirrors, reflected across the sides it shares with
// its neighbours. Each cell is found once, from the cell it is a reflection
// of, so a reflection always comes out of a mirror already there: the first
// ring out of the three mirrors, the next ring out of the first, and on.
//
// A REFLECTION COMES OUT OF ITS MIRROR. A cell's image does not appear in
// place: it slides out of the edge it shares with its parent, whole and at its
// own size, the part that has passed the mirror growing from the mirror line,
// and it comes out only once its parent is in place.

'use strict';

const { rng } = require('../../core/rand.js');
const { hold, keep, soft } = require('./held.js');
const P = require('./paper.js');
const D = require('./dry.js');

const LIFT = 1.1;           // seconds the pieces take to lift
const STAND = [1.15, 2.7];  // the mirrors slide in and stand between these seconds
const OPEN = 2.85;          // the first reflections begin to come out of the mirrors
const DONE = 5.4;           // and the last is in place, however many rings the frame holds
const SHADOW = 18;          // how far a lifted piece's shadow falls, in design units
const HEIGHT = 26;          // how far a standing mirror's shadow falls
const GLASS = 4.5;          // a mirror's thickness, seen from above

/** Build stage: how each piece lifts, where the mirrors stand, and every cell of the wallpaper that covers the frame. */
function place(s) {
  const R = rng(s.seed);
  const side = s.params.side;
  // The triangle about the painting's focus, kept inside the frame, turned.
  const cx = Math.max(side * 0.7, Math.min(P.W - side * 0.7, s.focus[0] + (R('mirror', 'x') - 0.5) * 120));
  const cy = Math.max(side * 0.6, Math.min(P.H - side * 0.6, s.focus[1] + (R('mirror', 'y') - 0.5) * 80));
  const turn = R('mirror', 'turn') * Math.PI * 2 / 3;
  const r = side / Math.sqrt(3);
  const tri = [0, 1, 2].map((i) => [cx + r * Math.cos(turn + i * 2 * Math.PI / 3), cy + r * Math.sin(turn + i * 2 * Math.PI / 3)]);
  s.triangle = tri;
  // The mirrors: one on each side, a little longer than the side, each sliding
  // in along its own line from beyond the frame.
  s.mirrors = [0, 1, 2].map((i) => {
    const a = tri[i], b = tri[(i + 1) % 3];
    const dx = (b[0] - a[0]) / side, dy = (b[1] - a[1]) / side;
    const ext = GLASS;
    const from = R('mirror', 'from', i) < 0.5 ? -1 : 1;
    const t0 = STAND[0] + i * (STAND[1] - STAND[0]) / 3.4;
    return { a: [a[0] - dx * ext, a[1] - dy * ext], b: [b[0] + dx * ext, b[1] + dy * ext], dx, dy, from, t0, t1: t0 + 0.65 };
  });
  // The cells: breadth first from the triangle, each the reflection of its
  // parent across the side they share, until the frame is covered.
  const key = (p) => Math.round(p[0] / 4) + ',' + Math.round(p[1] / 4);
  const centroid = (t) => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
  const seen = new Set([key(centroid(tri))]);
  s.cells = [{ tri, m: [1, 0, 0, 1, 0, 0], ring: 0, parent: -1, edge: null }];
  for (let q = 0; q < s.cells.length; q++) {
    const c = s.cells[q];
    for (let e = 0; e < 3; e++) {
      const a = c.tri[e], b = c.tri[(e + 1) % 3], o = c.tri[(e + 2) % 3];
      const ref = reflection(a, b);
      const tri2 = [a, b, apply(ref, o)];
      const cc = centroid(tri2);
      if (cc[0] < -side || cc[0] > P.W + side || cc[1] < -side || cc[1] > P.H + side) continue;
      const k = key(cc);
      if (seen.has(k)) continue;
      seen.add(k);
      s.cells.push({ tri: tri2, m: compose(ref, c.m), ring: c.ring + 1, parent: q, wait: R('cell', 'wait', s.cells.length) });
    }
  }
  // Each reflection comes out once its parent is in place, so the rings follow
  // one another, at a pace that has the last ring in place by DONE.
  const per = Math.min(0.4, (DONE - OPEN) / s.cells[s.cells.length - 1].ring);
  s.unfold = per * 0.8;
  for (const c of s.cells) {
    if (c.ring > 0) c.start = (c.ring === 1 ? OPEN : s.cells[c.parent].start + s.unfold) + c.wait * per * 0.2;
  }
  // The pieces lift in the order they tore free, each by its own height.
  s.lifts = s.tiles.map((t, i) => ({
    at: 0.05 + (t.d / 6) * 0.35 + R('lift', 'at', i) * 0.25,
    height: 0.6 + R('lift', 'h', i) * 0.4,
    turn: (R('lift', 'turn', i) - 0.5) * 0.05,
    spread: 0.025 + R('lift', 'spread', i) * 0.015,
  }));
}

/** The reflection across the line through a and b, as [a, b, c, d, e, f]. */
function reflection(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const ca = (dx * dx - dy * dy) / l2, sa = 2 * dx * dy / l2;
  return [ca, sa, sa, -ca, a[0] - ca * a[0] - sa * a[1], a[1] - sa * a[0] + ca * a[1]];
}

/** p mapped by m. */
function apply(m, p) {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** m after n: first n, then m. */
function compose(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** How far the pieces have lifted at second `sec`, 0 to 1, each. */
function lifted(s, sec) {
  return s.lifts.map((l) => {
    const u = Math.max(0, Math.min(1, (sec - l.at) / (LIFT - l.at)));
    return u * u * (3 - 2 * u) * l.height;
  });
}

/**
 * The torn sheet lifted off its table: the gaps empty, the torn edges and
 * their fibres kept. Tear by tear, in the order they opened, as the tearing
 * laid them, so the sheet over its table is the tearing's last frame.
 */
function torn(g, s) {
  D.dried(g, s);
  for (const i of s.tearOrder) D.drawTears(g, s, Infinity, [i], 'cut');
}

/** The table under the sheet, with the torn edges' shadows on it, tear by tear. */
function table(g, s) {
  g.fillStyle = D.TABLE;
  g.fillRect(-10, -10, P.W + 20, P.H + 20);
  for (const i of s.tearOrder) D.drawTears(g, s, Infinity, [i], 'shade');
}

/**
 * The table and the pieces over it, lifted as far as they are at second
 * `sec`; the table kept, or with `direct` drawn, for a copy of its own.
 */
function pieces(g, s, sec, sheet, direct = false) {
  drawPieces(g, s, sec, sheet, (tg) => (direct ? table(tg, s) : hold(tg, s, 'table', table)), soft);
}

/** The scene once every piece has lifted, as a kept copy made from the kept torn `sheet`. */
function scene(g, s, sheet) {
  return keep(g, s, 'lifted', (cg, cs) => pieces(cg, cs, LIFT, sheet, true));
}

/**
 * The table and the torn pieces over it at second `sec`: each piece raised
 * towards the eye, turned a little, drawn a little apart from the others and
 * curling towards the light, with its soft shadow on the table as far from it
 * as it is raised. `sheet` is the torn sheet with its gaps cut out, as a kept
 * copy; `table(g)` paints the table under it, opaque, with the torn edges'
 * shadows.
 */
function drawPieces(g, s, sec, sheet, table, soft) {
  const up = lifted(s, sec);
  const lx = Math.cos(s.light), ly = Math.sin(s.light);
  g.save();
  table(g);
  if (up.every((u) => u <= 0.001)) {
    // Nothing lifted yet: the sheet as it lies, uncut by the pieces' outlines.
    g.drawImage(sheet, 0, 0, P.W, P.H);
    g.restore();
    return;
  }
  const at = s.tiles.map((t, i) => placed(t, s.lifts[i], up[i]));
  // The shadows, soft: laid at a quarter of the resolution.
  soft(g, 4, (sg) => {
    sg.fillStyle = 'rgba(8, 6, 4, 0.5)';
    sg.beginPath();
    s.tiles.forEach((t, i) => {
      if (up[i] > 0.001) outline(sg, t.poly, at[i], -lx * SHADOW * up[i], -ly * SHADOW * up[i]);
    });
    sg.fill();
  });
  s.tiles.forEach((t, i) => {
    g.save();
    g.beginPath();
    outline(g, t.poly, at[i], 0, 0);
    g.clip();
    g.transform(at[i][0], at[i][1], at[i][2], at[i][3], at[i][4], at[i][5]);
    g.drawImage(sheet, 0, 0, P.W, P.H);
    if (up[i] > 0.001) {
      // Curling as it lifts: lighter on the side that faces the light, darker away.
      const [cx, cy] = t.centre;
      const r = t.reach || (t.reach = Math.max(...t.poly.map((p) => Math.hypot(p[0] - cx, p[1] - cy))));
      const curl = g.createLinearGradient(cx + lx * r, cy + ly * r, cx - lx * r, cy - ly * r);
      const a = (0.12 * up[i]).toFixed(3);
      curl.addColorStop(0, 'rgba(255, 252, 244, ' + a + ')');
      curl.addColorStop(1, 'rgba(24, 18, 12, ' + a + ')');
      g.fillStyle = curl;
      g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    g.restore();
  });
  g.restore();
}

/**
 * Where a piece lifted by `u` lies, as a transform: scaled up a little about
 * its centre (nearer the eye), turned by its own small angle, and moved away
 * from the middle of the sheet in proportion to its distance, so the torn
 * sheet opens as it lifts and the gaps widen.
 */
function placed(t, l, u) {
  const [cx, cy] = t.centre || (t.centre = centre(t.poly));
  const k = 1 + 0.008 * u, a = l.turn * u, c = Math.cos(a) * k, sn = Math.sin(a) * k;
  const tx = cx + (cx - P.W / 2) * l.spread * u, ty = cy + (cy - P.H / 2) * l.spread * u;
  return [c, sn, -sn, c, tx - c * cx + sn * cy, ty - sn * cx - c * cy];
}

function centre(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/** A piece's outline mapped by `m` and moved by (dx, dy). */
function outline(g, pts, m, dx, dy) {
  const [x0, y0] = apply(m, pts[0]);
  g.moveTo(x0 + dx, y0 + dy);
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = apply(m, pts[i]);
    g.lineTo(x + dx, y + dy);
  }
  g.closePath();
}

/** How far a cell's reflection has come out of its mirror at second `sec`, 0 to 1. */
function opened(s, c, sec) {
  if (c.ring === 0) return 1;
  const u = Math.max(0, Math.min(1, (sec - c.start) / s.unfold));
  // Quick out of the mirror, slowing as it comes into place.
  return 1 - (1 - u) * (1 - u) * (1 - u);
}

/**
 * A cell's reflection come `u` of the way out of its mirror, the cell's first
 * side: its image moved back towards the mirror by the rest of the cell's
 * height, (sx, sy), and the part of the cell that has passed the mirror, a
 * triangle like the cell's growing from the mirror line, `tri`.
 */
function emerged(c, u) {
  const [a, b, o] = c.tri;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const k = ((o[0] - a[0]) * dx + (o[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const sx = (a[0] + dx * k - o[0]) * (1 - u), sy = (a[1] + dy * k - o[1]) * (1 - u);
  const top = [o[0] + sx, o[1] + sy];
  const foot = (p) => [p[0] + sx + (top[0] - p[0] - sx) * (1 - u), p[1] + sy + (top[1] - p[1] - sy) * (1 - u)];
  return { sx, sy, tri: [foot(a), foot(b), top] };
}

/**
 * The reflections at second `sec`: every cell whose reflection has begun to
 * come out of its mirror. `scene` is the lifted sheet as a kept copy, drawn
 * at the design box.
 */
function drawReflections(g, s, sec, scene) {
  const m = g.getTransform();
  for (let i = 1; i < s.cells.length; i++) {
    const c = s.cells[i];
    const u = opened(s, c, sec);
    if (u <= 0) continue;
    const { sx, sy, tri } = emerged(c, u);
    g.save();
    g.beginPath();
    g.moveTo(tri[0][0], tri[0][1]);
    g.lineTo(tri[1][0], tri[1][1]);
    g.lineTo(tri[2][0], tri[2][1]);
    g.closePath();
    g.clip();
    g.setTransform(m);
    g.transform(c.m[0], c.m[1], c.m[2], c.m[3], c.m[4] + sx, c.m[5] + sy);
    g.drawImage(scene, 0, 0, P.W, P.H);
    g.restore();
  }
}

/**
 * The mirrors at second `sec`: three strips of silvered glass standing on
 * the sheet, seen from above, each sliding in along its line until it stands
 * on its side of the triangle. Each casts a shadow away from the light and
 * throws the light back on its other side; its glass shows end on, pale
 * green, lit along one edge, the silvering dark behind it, and once it stands
 * a glint runs along it. The images of the mirrors, the sides of every
 * reflection that has come out, move out with their reflections.
 */
function drawMirrors(g, s, sec, soft) {
  const lx = Math.cos(s.light), ly = Math.sin(s.light);
  g.save();
  g.lineCap = 'butt';
  const images = [];
  for (let i = 1; i < s.cells.length; i++) {
    const u = opened(s, s.cells[i], sec);
    if (u > 0) images.push(emerged(s.cells[i], u).tri);
  }
  if (images.length) {
    const sides = (dx, dy) => {
      g.beginPath();
      for (const t of images) {
        g.moveTo(t[0][0] + dx, t[0][1] + dy);
        g.lineTo(t[2][0] + dx, t[2][1] + dy);
        g.lineTo(t[1][0] + dx, t[1][1] + dy);
      }
      g.stroke();
    };
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(20, 18, 16, 0.16)';
    sides(-lx * 1.2, -ly * 1.2);
    g.strokeStyle = 'rgba(252, 250, 244, 0.32)';
    sides(0, 0);
  }
  const standing = [];
  for (const mr of s.mirrors) {
    const u = Math.max(0, Math.min(1, (sec - mr.t0) / (mr.t1 - mr.t0)));
    if (u <= 0) continue;
    const slide = (1 - u) * (1 - u) * (1 - u) * mr.from * (P.W + P.H);
    standing.push({ mr, u, a: [mr.a[0] + mr.dx * slide, mr.a[1] + mr.dy * slide], b: [mr.b[0] + mr.dx * slide, mr.b[1] + mr.dy * slide] });
  }
  if (standing.length) {
    // The shadows, and the light thrown back: soft, at a third of the resolution.
    soft(g, 3, (sg) => {
      sg.fillStyle = 'rgba(10, 8, 6, 0.42)';
      sg.beginPath();
      for (const { a, b } of standing) band(sg, a, b, -lx * HEIGHT, -ly * HEIGHT);
      sg.fill();
      sg.fillStyle = 'rgba(255, 251, 238, 0.22)';
      sg.beginPath();
      for (const { mr, a, b } of standing) {
        const nx = -mr.dy, ny = mr.dx, d = 2 * (-lx * nx - ly * ny) * HEIGHT;
        band(sg, a, b, -lx * HEIGHT - d * nx, -ly * HEIGHT - d * ny);
      }
      sg.fill();
    });
  }
  const t = s.triangle, mx = (t[0][0] + t[1][0] + t[2][0]) / 3, my = (t[0][1] + t[1][1] + t[2][1]) / 3;
  for (const { mr, u, a, b } of standing) {
    // n: across the mirror, away from the triangle, where the silvering is.
    let nx = -mr.dy, ny = mr.dx;
    if ((a[0] - mx) * nx + (a[1] - my) * ny < 0) { nx = -nx; ny = -ny; }
    const h = GLASS / 2, lit = nx * lx + ny * ly > 0 ? 1 : -1;
    g.fillStyle = 'rgba(176, 196, 188, 0.92)';
    g.beginPath();
    band(g, [a[0] - nx * h, a[1] - ny * h], [b[0] - nx * h, b[1] - ny * h], nx * GLASS, ny * GLASS);
    g.fill();
    edge(g, a, b, nx * (h - 0.5), ny * (h - 0.5), 'rgba(34, 38, 38, 0.9)', 1.1);
    edge(g, a, b, nx * lit * (h - 0.45), ny * lit * (h - 0.45), 'rgba(252, 255, 253, 0.95)', 0.9);
    if (u >= 1) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const at = ((sec - mr.t1) * 140 + mr.from * 97) % (len + 200) - 100;
      const g0 = Math.max(0, at - 30), g1 = Math.min(len, at + 30);
      if (g1 > g0) {
        const ox = nx * lit * (h - 0.45), oy = ny * lit * (h - 0.45);
        edge(g, [a[0] + mr.dx * g0, a[1] + mr.dy * g0], [a[0] + mr.dx * g1, a[1] + mr.dy * g1], ox, oy, 'rgba(255, 255, 252, 0.9)', 2);
      }
    }
  }
  g.restore();
}

/** The quadrilateral from a to b and on by (vx, vy). */
function band(g, a, b, vx, vy) {
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.lineTo(b[0] + vx, b[1] + vy);
  g.lineTo(a[0] + vx, a[1] + vy);
  g.closePath();
}

/** A line from a to b moved by (dx, dy). */
function edge(g, a, b, dx, dy, colour, width) {
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(a[0] + dx, a[1] + dy);
  g.lineTo(b[0] + dx, b[1] + dy);
  g.stroke();
}

module.exports = { place, torn, pieces, scene, drawReflections, drawMirrors, LIFT };
