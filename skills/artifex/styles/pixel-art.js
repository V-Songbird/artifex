// Pixel art: 2D pictures on a coarse grid, made the way a sprite artist
// works: one small palette, hard edges, ordered dithering for gradients,
// dark one-cell outlines and stepped shading. Everything is drawn into a grid
// of palette colours first and emitted as hard-edged runs last.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

// The 4 x 4 Bayer matrix for ordered dithering.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// True when a cell at (x, y) takes the next colour at fraction f (0..1).
const dither = (x, y, f) => f * 16 > BAYER[(y % 4) * 4 + (x % 4)];

// A triangle wave in 0..1 with period 1, for stepped ridges and zigzags.
const tri = (u) => 1 - 2 * Math.abs(u - Math.floor(u) - 0.5);

// A w x h grid of colours filled with `fill`. put ignores cells outside the
// grid and empty colours; get returns null outside.
function grid(w, h, fill) {
  const px = new Array(w * h).fill(fill);
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h && c) px[y * w + x] = c; };
  const get = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : null);
  return { w, h, px, put, get };
}

// A vertical gradient over rows y0 to y1 - 1, columns x0 to x1 - 1, through
// the colour bands `ramp` top to bottom, each step dithered by Bayer.
function ramp(G, x0, y0, x1, y1, colours) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = ((y - y0) / (y1 - y0 - 1)) * (colours.length - 1);
      const i = Math.min(colours.length - 2, Math.floor(t));
      G.put(x, y, colours[dither(x, y, t - i) ? i + 1 : i]);
    }
  }
}

// A filled disc: every cell whose centre lies within r of (cx, cy).
function disc(G, cx, cy, r, colour) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) G.put(x, y, colour);
    }
  }
}

// A lit sphere in two tones: `shade` where (dx + dy) / r passes `cut`, so
// the light comes from the upper left.
function ball(G, cx, cy, r, light, shade, cut = 0.55) {
  for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      G.put(x, y, (x + 0.5 - cx + y + 0.5 - cy) / r > cut ? shade : light);
    }
  }
}

// A dithered glow `width` cells wide outside radius r, thinning outward over
// `fade` cells. `colour` is a colour or (x, y) => colour.
function halo(G, cx, cy, r, width, colour, fade = width + 0.2) {
  const reach = Math.ceil(r + width) + 1;
  for (let y = Math.floor(cy) - reach; y <= cy + reach; y++) {
    for (let x = Math.floor(cx) - reach; x <= cx + reach; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r && d <= r + width && dither(x, y, 1 - (d - r) / fade)) G.put(x, y, typeof colour === 'function' ? colour(x, y) : colour);
    }
  }
}

// A twinkle: one bright cell with a dim plus of four around it.
function twinkle(G, x, y, core, glow) {
  G.put(x, y, core);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) G.put(x + dx, y + dy, glow);
}

// A soft lump from a union of circles [cx, cy, r] cut flat at its lowest
// centre + 1.5: top-edge cells `light`, bottom-edge cells `dark`. Clouds, bushes, foam.
function lump(G, circles, light, mid, dark) {
  const base = Math.max(...circles.map((c) => c[1])) + 1.5;
  const inside = (x, y) => y + 0.5 <= base && circles.some(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r);
  const x0 = Math.floor(Math.min(...circles.map(([cx, , r]) => cx - r)));
  const x1 = Math.ceil(Math.max(...circles.map(([cx, , r]) => cx + r)));
  const y0 = Math.floor(Math.min(...circles.map(([, cy, r]) => cy - r)));
  for (let y = y0; y <= base; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      G.put(x, y, !inside(x, y - 1) ? light : !inside(x, y + 1) ? dark : mid);
    }
  }
}

// A ridge from column x0 to x1 - 1: filled from top(x) down to row `bottom`,
// its top cell `rim`. With `cap`, the cell under the rim is `cap` where the
// top is above row `capLine`: snow, frost, moss.
function ridge(G, x0, x1, top, bottom, fill, rim, { cap = null, capLine = 0 } = {}) {
  for (let x = x0; x < x1; x++) {
    const t = top(x);
    for (let y = t; y < bottom; y++) G.put(x, y, y === t ? rim : cap && y <= t + 1 && t < capLine ? cap : fill);
  }
}

// Whether (px, py) lies inside an ellipse at (cx, cy), radii rx, ry, turned by rot.
function inEllipse(px, py, cx, cy, rx, ry, rot = 0) {
  const c = Math.cos(rot); const s = Math.sin(rot); const dx = px - cx; const dy = py - cy;
  const u = (c * dx + s * dy) / rx; const v = (-s * dx + c * dy) / ry;
  return u * u + v * v <= 1;
}

// Rasterise shapes at cell centres: part(x + 0.5, y + 0.5) names the part a
// cell belongs to, or null. Returns h rows of w part names.
function mask(w, h, part) {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (__, x) => part(x + 0.5, y + 0.5)));
}

// The light at a cell of a round form centred (cx, cy) with radii (rx, ry), lit
// from the upper left: negative is lit, positive is in shade.
const light = (x, y, cx, cy, rx, ry) => ((x + 0.5 - cx) / rx) * 0.6 + ((y + 0.5 - cy) / ry) * 0.8;

// One of colours[0..n] by where t falls among the ascending `cuts`: stepped shading.
function step(t, colours, cuts = [-0.55, 0.25, 0.65]) {
  let i = 0;
  while (i < cuts.length && t >= cuts[i]) i++;
  return colours[i];
}

// A part's edge shading: `top` where the cell above is another part,
// `bottom` where the cell below is, `mid` inside. Flat parts read as forms.
function rim(m, x, y, top, mid, bottom) {
  const k = m[y][x];
  const is = (yy) => yy >= 0 && yy < m.length && m[yy][x] === k;
  return !is(y - 1) ? top : !is(y + 1) ? bottom : mid;
}

// A sprite from a mask: paint(part, x, y) colours each filled cell, and every
// empty cell four-adjacent to a filled one becomes `outline`. Returns rows of
// colours, null where empty.
function sprite(m, paint, outline) {
  const h = m.length; const w = m[0].length;
  const out = Array.from({ length: h }, () => new Array(w).fill(null));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = m[y][x];
      if (!k) {
        const touch = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (m[y + dy] || [])[x + dx]);
        if (touch) out[y][x] = outline;
        continue;
      }
      out[y][x] = paint(k, x, y);
    }
  }
  return out;
}

// Puts sprite rows on the grid with their top left at (x, y); null cells stay
// clear. Under `opacity` 1 the sprite fades as the medium does: whole cells
// drop by the Bayer threshold, counted from the sprite's own corner so the
// pattern travels with it.
function stamp(G, rows, x, y, opacity = 1) {
  rows.forEach((row, j) => row.forEach((c, i) => { if (dither(i, j, opacity)) G.put(x + i, y + j, c); }));
}

// The cells of a straight line from (x0, y0) to (x1, y1), in order. Its runs
// are as even as the slope allows: one length on a clean slope, two
// neighbouring lengths spread evenly on any other, the ends full runs.
function line(x0, y0, x1, y1) {
  const dx = x1 - x0; const dy = y1 - y0;
  const flat = Math.abs(dx) >= Math.abs(dy);
  const n = Math.abs(flat ? dx : dy) + 1; const m = Math.abs(flat ? dy : dx) + 1;
  const su = Math.sign(flat ? dx : dy); const sv = Math.sign(flat ? dy : dx);
  return Array.from({ length: n }, (_, i) => {
    const u = i * su; const v = Math.floor((i * m) / n) * sv;
    return flat ? [x0 + u, y0 + v] : [x0 + v, y0 + u];
  });
}

// The cells a path through `pts` (cell units) crosses, in order, as a line one
// cell thick that connects corner to corner: no elbow cell, and no run longer
// or shorter than both its neighbours twice in a row, so the runs change one
// way along a curve. `closed` joins the last point to the first.
function trace(pts, closed = false) {
  const cells = [];
  const path = closed ? [...pts, pts[0]] : pts;
  for (let k = 0; k + 1 < path.length; k++) {
    const [ax, ay] = path[k]; const [bx, by] = path[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 4));
    for (let i = 0; i <= steps; i++) {
      const c = [Math.floor(ax + ((bx - ax) * i) / steps), Math.floor(ay + ((by - ay) * i) / steps)];
      const last = cells[cells.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) cells.push(c);
    }
  }
  if (closed && cells.length > 1 && cells[0][0] === cells[cells.length - 1][0] && cells[0][1] === cells[cells.length - 1][1]) cells.pop();
  // An elbow: a cell whose two neighbours along the line already touch at a corner.
  for (let i = 1; i + 1 < cells.length; i++) {
    const a = cells[i - 1]; const b = cells[i + 1];
    if (Math.abs(a[0] - b[0]) === 1 && Math.abs(a[1] - b[1]) === 1) cells.splice(i--, 1);
  }
  for (const axis of [1, 0]) evenRuns(cells, axis);
  return cells;
}

// Runs along `1 - axis` (cells in a row for axis 1) that step one cell the
// same diagonal way from each to the next. Where four in a row go up, down, up
// or down, up, down in length, the middle two trade lengths: the cells stay as
// many and the ends stay put.
function evenRuns(cells, axis) {
  const along = 1 - axis;
  const step = (i, k) => cells[i][k] - cells[i - 1][k];
  const runs = [{ at: 0, len: 1 }];
  for (let i = 1; i < cells.length; i++) {
    if (step(i, axis) === 0) runs[runs.length - 1].len++;
    else runs.push({ at: i, len: 1 });
  }
  for (let i = 0; i + 3 < runs.length; i++) {
    const [a, b, c, d] = runs.slice(i, i + 4);
    // One way along and one way across, a cell at a time, from a's start to d's end.
    let chain = true;
    for (let k = a.at + 1; k < d.at + d.len; k++) {
      chain = chain && step(k, along) === step(a.at + a.len, along) && Math.abs(step(k, along)) === 1
        && (step(k, axis) === 0 || step(k, axis) === step(a.at + a.len, axis)) && Math.abs(step(k, axis)) <= 1;
    }
    if (!chain || (b.len - a.len) * (c.len - b.len) >= 0 || (c.len - b.len) * (d.len - c.len) >= 0) continue;
    const [v1, v2] = [cells[b.at][axis], cells[c.at][axis]];
    for (let k = 0; k < b.len + c.len; k++) cells[b.at + k][axis] = k < c.len ? v1 : v2;
    [b.len, c.len, c.at] = [c.len, b.len, b.at + c.len];
  }
}

// Puts `cells`, as `line` and `trace` return them, on the grid in one colour.
function plot(G, cells, colour) {
  for (const [x, y] of cells) G.put(x, y, colour);
}

// A grid of light the size of the colour grid: red, green and blue to add at
// each cell, from 0. The colour grid keeps its hard palette steps; softness
// lives only here.
function lights(w, h) {
  return { w, h, rgb: new Float32Array(w * h * 3) };
}

// Adds a glow to the light grid: `colour` (#rrggbb) at `strength` at (cx, cy),
// falling to nothing at `radius` cells as (1 - d) squared of the distance d
// over the radius, steep near the source with a long soft foot.
function glow(L, cx, cy, radius, colour, strength = 1) {
  const c = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) * strength);
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(L.h, cy + radius); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(L.w, cx + radius); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d);
      for (let k = 0; k < 3; k++) L.rgb[(y * L.w + x) * 3 + k] += c[k] * f;
    }
  }
}

// Adds the light grid over the emitted colour grid, cell for cell, at the same
// `cell` size: each cell one flat amount of light, so the grid still shows.
function emitLight(g, L, cell) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let y = 0; y < L.h; y++) {
    for (let x = 0; x < L.w; x++) {
      const i = (y * L.w + x) * 3;
      const [r, gr, b] = [0, 1, 2].map((k) => Math.min(255, Math.round(L.rgb[i + k])));
      if (!(r || gr || b)) continue;
      g.fillStyle = `rgb(${r}, ${gr}, ${b})`;
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  g.restore();
}

// Mirrors the whole grid left to right.
function mirror(G) {
  for (let y = 0; y < G.h; y++) G.px.splice(y * G.w, G.w, ...G.px.slice(y * G.w, y * G.w + G.w).reverse());
}

// Emits the grid with cells `cell` units wide as horizontal runs of one
// colour, each `overlap` wider so no seam shows between runs.
function emit(g, G, cell, overlap = 0.6) {
  for (let y = 0; y < G.h; y++) {
    let x = 0;
    while (x < G.w) {
      const c = G.px[y * G.w + x];
      let run = 1;
      while (x + run < G.w && G.px[y * G.w + x + run] === c) run++;
      g.fillStyle = c;
      g.fillRect(x * cell, y * cell, run * cell + overlap, cell + overlap);
      x += run;
    }
  }
}

module.exports = { BAYER, dither, tri, grid, ramp, disc, ball, halo, twinkle, lump, ridge, inEllipse, mask, light, step, rim, sprite, stamp, line, trace, plot, lights, glow, emitLight, mirror, emit };
