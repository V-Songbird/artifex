// Voxel: 3D built from cubes, the way Minecraft draws a world. Each block is
// an isometric box whose faces carry 16 x 16 texel textures, shaded top,
// left and right by orientation alone; hidden faces are culled and boxes
// drawn back to front. Flat untextured slabs and haze toward the sky are
// drawn with the same projection.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { noise2 } = require('../../../core/rand.js');

// Light from face orientation only, as an sRGB multiply.
const SHADE = { top: 1, left: 0.8, right: 0.63 };

// Material palettes, dark to light.
const PAL = {
  grass: ['#4f8a2e', '#5c9a36', '#69a83e', '#77b548', '#86c154'],
  dirt: ['#5b3a21', '#6a4527', '#79502e', '#885c36', '#96683f'],
  stone: ['#7d7d7d', '#939393'],
  bark: ['#43301c', '#523a22', '#61452a', '#704f31'],
  ring: ['#8a6a40', '#a07d4f', '#b38f5d'],
};

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// A hex colour multiplied by k, cached.
const shadeCache = new Map();
function shaded(hex, k) {
  const key = hex + k;
  let v = shadeCache.get(key);
  if (!v) {
    v = '#' + hexRgb(hex).map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('');
    shadeCache.set(key, v);
  }
  return v;
}

// A hex colour mixed toward the haze [r, g, b] by k, cached: distance.
const hazeCache = new Map();
function hazed(hex, k, haze) {
  const key = hex + k + haze;
  let v = hazeCache.get(key);
  if (!v) {
    v = '#' + hexRgb(hex).map((c, i) => Math.round(c + (haze[i] - c) * k).toString(16).padStart(2, '0')).join('');
    hazeCache.set(key, v);
  }
  return v;
}

// The isometric projection for blocks of size S with the origin at (ox, oy):
// returns (x, y, z) => [px, py], x to the lower right, y to the lower left, z up.
const iso = (S, ox, oy) => (x, y, z) => [ox + (x - y) * S * 0.866, oy + (x + y) * S * 0.5 - z * S];

// A set of unit blocks: block(x, y, z, mat) adds one and records its cell,
// so faces between neighbours are culled.
function world() {
  const boxes = [];
  const cell = new Set();
  return { boxes, cell, block: (x, y, z, mat) => { boxes.push({ x, y, z, w: 1, d: 1, h: 1, mat }); cell.add(`${x},${y},${z}`); } };
}

// Painter's order for a box: the sum of its centre's x, y and 0.9 z.
const depth = (b) => b.x + b.w / 2 + b.y + b.d / 2 + (b.z + b.h / 2) * 0.9;

// The indices of `list` back to front, leaving it as it is: by depth, then each box after every box
// it overlaps on screen and lies in front of. Two boxes overlap on screen when
// their ranges of x - y, y - z and x - z all overlap, which holds for iso()
// proportions only; a box lies behind another when it ends at or before the
// other's start on x, y or z. Among the boxes free to go next, the lowest depth
// goes first. Of two boxes that cut into each other, the lower depth goes
// first, as if it lay behind the other, unless a chain of boxes, each behind
// the next or an intersecting pair already ordered, puts the other first. Where boxes form
// a cycle, each in front of the next, no order is right: the cycle starts at
// its box of lowest depth and follows the cycle from there, and boxes outside
// it still go after the boxes they lie in front of.
function backToFront(list) {
  const index = [...list.keys()].sort((p, q) => depth(list[p]) - depth(list[q]));
  const boxes = index.map((k) => list[k]);
  // Unit cubes on the integer grid already lie in depth order among
  // themselves, and cubes that wait on nothing come out in that order, so two
  // cubes are compared only once one of them waits on a box.
  const queue = [...boxes.keys()].filter((i) => { const { x, y, z, w, d, h } = boxes[i]; return !(w === 1 && d === 1 && h === 1 && x % 1 === 0 && y % 1 === 0 && z % 1 === 0); });
  if (!queue.length) return index;
  const n = boxes.length, e = 1e-9;
  const span = boxes.map(({ x, y, z, w, d, h }) => [x - y - d, x + w - y, y - z - h, y + d - z, x - z - h, x + w - z]);
  const behind = (a, b) => a.x + a.w <= b.x + e || a.y + a.d <= b.y + e || a.z + a.h <= b.z + e;
  const after = boxes.map(() => []), before = boxes.map(() => []), need = new Uint32Array(n);
  // Each box goes into the cells of a grid on x - y and y - z that its ranges
  // cover short of their ends by e, a cell as wide as nine boxes in ten on
  // each axis, and tests only the boxes that share a cell with it: two boxes
  // that overlap on screen share the cell where the later start lies. A box
  // that would cover more than 64 cells, or cells past exact whole numbers, is long. More than 16 long boxes go
  // into a coarser grid as well, a cell as wide as nine long boxes in ten,
  // which also holds every other box: a box tests the long boxes that share a
  // coarse cell with it, and a long box tests every box that does. Any other
  // long box goes on a list of its own: every box tests it, and it tests every
  // box. A box tests long boxes before the boxes in its cells, and a long box
  // tests boxes in index order, so the order pairs are found in does not
  // depend on the coarse grid. A grid keeps rows by the first cell number and
  // cells by the second, so no two cells share a key.
  const wide = (list, k) => list.map((p) => p[k + 1] - p[k]).sort((a, b) => a - b)[Math.floor(list.length * 0.9)] || 1;
  const cover = (p, sx, sy) => {
    const a0 = Math.floor(p[0] / sx), c0 = Math.floor(p[2] / sy);
    return [a0, Math.max(a0, Math.floor((p[1] - e) / sx)), c0, Math.max(c0, Math.floor((p[3] - e) / sy))];
  };
  const fits = (r) => r.every(Number.isSafeInteger) && (r[1] - r[0] + 1) * (r[3] - r[2] + 1) <= 64;
  const put = (grid, r, i) => {
    for (let a = r[0]; a <= r[1]; a++) {
      let row = grid.get(a);
      if (!row) grid.set(a, row = new Map());
      for (let c = r[2]; c <= r[3]; c++) { const list = row.get(c); if (list) list.push(i); else row.set(c, [i]); }
    }
  };
  const visit = (grid, r, f) => {
    for (let a = r[0]; a <= r[1]; a++) { const row = grid.get(a); if (row) for (let c = r[2]; c <= r[3]; c++) { const list = row.get(c); if (list) for (const j of list) f(j); } }
  };
  const cx = wide(span, 0), cy = wide(span, 2), cells = new Map(), range = [], long = [], none = [];
  span.forEach((p, i) => { const r = cover(p, cx, cy); if (fits(r)) { range[i] = r; put(cells, r, i); } else long.push(i); });
  let lone = long, far = null;
  const coarse = new Map(), all = new Map();
  if (long.length > 16) {
    const kx = Math.max(cx, wide(long.map((i) => span[i]), 0)), ky = Math.max(cy, wide(long.map((i) => span[i]), 2));
    lone = [];
    far = [];
    span.forEach((p, i) => {
      const r = cover(p, kx, ky);
      if (!range[i] && !fits(r)) { lone.push(i); return; }
      far[i] = r;
      put(all, r, i);
      if (!range[i]) put(coarse, r, i);
    });
  }
  // The boxes `take` gathers for the box being scanned, once each, in index order.
  const gathered = new Uint32Array(n), got = new Int32Array(n);
  let taken = 0, stamp = 0;
  const take = (j) => { if (got[j] !== stamp) { got[j] = stamp; gathered[taken++] = j; } };
  const queued = new Uint8Array(n), scanned = new Uint8Array(n), met = new Int32Array(n), soft = [];
  queue.forEach((i) => { queued[i] = 1; });
  const pair = (i, j) => {
    if (scanned[j] || met[j] === i + 1) return;
    met[j] = i + 1;
    const p = span[i], q = span[j];
    if (p[0] >= q[1] - e || q[0] >= p[1] - e || p[2] >= q[3] - e || q[2] >= p[3] - e || p[4] >= q[5] - e || q[4] >= p[5] - e) return;
    // Boxes that cut into each other lie behind each other on no axis: the
    // lower index, which is the lower depth, goes first, once every real
    // relation is known.
    const ij = behind(boxes[i], boxes[j]), ji = !ij && behind(boxes[j], boxes[i]);
    const a = ji || (!ij && j < i) ? j : i, b = a === i ? j : i;
    if (ij || ji) { after[a].push(b); before[b].push(a); need[b]++; } else soft.push([a, b]);
    if (!queued[b]) { queued[b] = 1; queue.push(b); }
  };
  for (const i of queue) {
    const r = range[i];
    scanned[i] = 1;
    stamp = i + 1;
    taken = 0;
    if (r) {
      if (far) { lone.forEach(take); visit(coarse, far[i], take); for (const j of gathered.subarray(0, taken).sort()) pair(i, j); } else for (const j of lone) pair(i, j);
      for (let a = r[0]; a <= r[1]; a++) { const row = cells.get(a); if (row) for (let c = r[2]; c <= r[3]; c++) for (const j of row.get(c) || none) pair(i, j); }
    } else if (far && far[i]) {
      lone.forEach(take);
      visit(all, far[i], take);
      if (taken * 16 > n) for (let j = 0; j < n; j++) pair(i, j);
      else for (const j of gathered.subarray(0, taken).sort()) pair(i, j);
    } else for (let j = 0; j < n; j++) pair(i, j);
  }
  // Kahn's algorithm on a min-heap of indices, which are in depth order.
  const heap = [], done = new Uint8Array(n), out = [], seen = new Uint8Array(n), back = new Uint8Array(n);
  const walk = (edges, i, mark) => {
    mark[i] = 1;
    for (const st = [i]; st.length;) for (const j of edges[st.pop()]) if (!done[j] && !mark[j]) { mark[j] = 1; st.push(j); }
  };
  const push = (i) => {
    let k = heap.push(i) - 1;
    for (let p; k && heap[p = (k - 1) >> 1] > i; k = p) heap[k] = heap[p];
    heap[k] = i;
  };
  const pop = () => {
    const top = heap[0], last = heap.pop(), m = heap.length;
    if (!m) return top;
    let k = 0;
    for (let c; (c = 2 * k + 1) < m; k = c) {
      if (c + 1 < m && heap[c + 1] < heap[c]) c++;
      if (heap[c] >= last) break;
      heap[k] = heap[c];
    }
    heap[k] = last;
    return top;
  };
  // An intersecting pair keeps its order only when no chain of relations,
  // real or of pairs already ordered, puts the other box first. The pair's lower index goes first, so
  // such a chain needs a relation from a higher index to a lower one; without
  // one no search runs, and a search stops once it meets the other box.
  const down = after.some((list, i) => list.some((j) => j < i)), mark = new Int32Array(n), st = [];
  soft.forEach(([a, b], s) => {
    let found = false;
    if (down) for (st.push(b), mark[b] = s + 1; st.length && !found;) for (const j of after[st.pop()]) { if (j === a) found = true; else if (mark[j] !== s + 1) { mark[j] = s + 1; st.push(j); } }
    st.length = 0;
    if (!found) { after[a].push(b); before[b].push(a); need[b]++; }
  });
  for (let i = 0; i < n; i++) if (!need[i]) push(i);
  while (out.length < n) {
    let i;
    if (heap.length) i = pop();
    else {
      // Every box left waits on another, so the boxes left hold a cycle. The
      // root of the last search over them lies in a cycle that waits on no
      // box outside it, and the boxes that lead to that root are that cycle:
      // its lowest-depth box goes next.
      seen.fill(0);
      back.fill(0);
      let root = 0;
      for (let r = 0; r < n; r++) if (!done[r] && !seen[r]) { root = r; walk(after, r, seen); }
      walk(before, root, back);
      i = back.indexOf(1);
    }
    done[i] = 1;
    out.push(index[i]);
    for (const j of after[i]) if (!--need[j] && !done[j]) push(j);
  }
  return out;
}

// One textured face: an affine transform maps texel (u, v) onto the
// parallelogram o, pu (u end), pv (v end), then colourAt(u, v) fills each texel
// 1.06 wide, so no seam shows between texels.
function face(g, o, pu, pv, nu, nv, colourAt) {
  g.save();
  g.transform((pu[0] - o[0]) / nu, (pu[1] - o[1]) / nu, (pv[0] - o[0]) / nv, (pv[1] - o[1]) / nv, o[0], o[1]);
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      g.fillStyle = colourAt(u, v);
      g.fillRect(u, v, 1.06, 1.06);
    }
  }
  g.restore();
}

// Boxes { x, y, z, w, d, h, mat } painted back to front in the order
// backToFront gives, with their visible faces: top, left
// (+y) and right (+x), skipping a face whose neighbouring cell is filled unless
// the box is `free`. tex[mat](face, u, v, id) colours a texel; a box's
// `decal(face, u, v, nu, nv)` may override it. Faces get texels x size texels;
// haze mixes every texel toward hazeColour. A box's id is its `key` when it has
// one, else base plus its index in `boxes`, which drawBoxes leaves in the
// caller's order, so paint order never changes a texture, even when one list is
// drawn on every frame, and a keyed box keeps its texture when boxes come and go.
// A key is a whole number of 0 or more, used without base, and must not repeat
// another box's id.
function drawBoxes(g, boxes, cell, at, tex, { haze = 0, hazeColour = null, base = 0, texels = 16 } = {}) {
  for (const k of backToFront(boxes)) {
    const b = boxes[k];
    const { x, y, z, w, d, h } = b;
    const id = b.key ?? base + k;
    const n = (q) => Math.max(1, Math.round(texels * q));
    const open = (dx, dy, dz) => b.free || !cell.has(`${x + dx},${y + dy},${z + dz}`);
    const paint = (name, nu, nv) => (u, v) => {
      let c = tex[b.mat](name, u, v, id);
      const mark = b.decal && b.decal(name, u, v, nu, nv);
      if (mark) c = mark;
      c = shaded(c, SHADE[name]);
      return haze ? hazed(c, haze, hazeColour) : c;
    };
    const fc = (name, o, pu, pv, nu, nv) => face(g, o, pu, pv, nu, nv, paint(name, nu, nv));
    if (open(0, 0, 1)) fc('top', at(x, y, z + h), at(x + w, y, z + h), at(x, y + d, z + h), n(w), n(d));
    if (open(0, 1, 0)) fc('left', at(x, y + d, z + h), at(x + w, y + d, z + h), at(x, y + d, z), n(w), n(h));
    if (open(1, 0, 0)) fc('right', at(x + w, y + d, z + h), at(x + w, y, z + h), at(x + w, y + d, z), n(d), n(h));
  }
}

// A flat untextured slab, one cell per '1' in `rows`, blocks of size S at
// (x, y), `height` of a block tall: clouds, water, shadows. Faces in `colours`
// [top, left, right], lit like the blocks.
function slab(g, { S, x, y, rows, height = 0.35, colours = ['#ffffff', '#e3ecf7', '#cfdcee'] }) {
  const A = S * 0.866; const B = S * 0.5; const H = S * height;
  const at = (i, j, z) => [x + (i - j) * A, y + (i + j) * B - z * H];
  const on = (i, j) => (rows[j] || '')[i] === '1';
  const cells = [];
  rows.forEach((row, j) => [...row].forEach((c, i) => { if (c === '1') cells.push([i, j]); }));
  cells.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
  const quad = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill(); };
  for (const [i, j] of cells) {
    if (!on(i, j + 1)) quad([at(i, j + 1, 1), at(i + 1, j + 1, 1), at(i + 1, j + 1, 0), at(i, j + 1, 0)], colours[1]);
    if (!on(i + 1, j)) quad([at(i + 1, j, 1), at(i + 1, j + 1, 1), at(i + 1, j + 1, 0), at(i + 1, j, 0)], colours[2]);
    quad([at(i, j, 1), at(i + 1, j, 1), at(i + 1, j + 1, 1), at(i, j + 1, 1)], colours[0]);
  }
}

// One of a palette sorted dark to light by n in 0..1.
const pick = (pal, n) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(n * pal.length)))];

// A texel's value: 0.65 value noise at `scale` texels plus 0.35 hash, offset
// per block id so repeats do not show.
const texel = (R, name, id, u, v, scale = 3) =>
  0.65 * noise2(R, (u + id * 23) / scale, (v + id * 7) / scale, name) + 0.35 * R(name, 'texel', id * 4096 + v * 64 + u);

// Textures: each returns (face, u, v, id) => colour for drawBoxes.

// Grass block: speckled green top; sides of dirt under a jagged green lip
// 3 to 5 texels deep, with rare stone pebbles.
function grassTexture(R, pal = PAL) {
  return (face, u, v, id) => {
    if (face === 'top') return pick(pal.grass, texel(R, 'grass', id, u, v));
    const lip = 3 + (R('lip', 'depth', id * 64 + u) < 0.45 ? 1 : 0) + (u % 5 === 2 ? 1 : 0);
    if (v < lip) return pick(pal.grass, texel(R, 'grassSide', id, u, v, 2) * 0.8);
    return R('pebble', 'p', id * 4096 + v * 64 + u) < 0.035 ? pick(pal.stone, R('pebble', 't', u + v)) : pick(pal.dirt, texel(R, 'dirt', id, u, v));
  };
}

// Dirt block: mottled brown with rare stone pebbles.
function dirtTexture(R, pal = PAL) {
  return (face, u, v, id) => (R('pebble', 'p', id * 4096 + v * 64 + u + 999) < 0.04
    ? pick(pal.stone, R('pebble', 't', u * v)) : pick(pal.dirt, texel(R, 'dirt', id, u, v)));
}

// Log block: vertical bark stripes on the sides, square growth rings on top.
function logTexture(R, pal = PAL) {
  return (face, u, v, id) => {
    if (face === 'top') {
      const d = Math.max(Math.abs(u - 7.5), Math.abs(v - 7.5));
      return d > 6.5 ? pal.bark[1] : pal.ring[Math.floor(d / 2) % 2 ? 0 : 2];
    }
    const stripe = (u * 7 + (id % 3)) % 4;
    return pal.bark[(stripe + Math.floor(texel(R, 'bark', id, u, v, 2) * 2)) % 4];
  };
}

// Speckle: one palette by texel noise at `scale`: leaves, wool, sand, ore-free stone.
function speckle(R, name, pal, scale = 3) {
  return (face, u, v, id) => pick(pal, texel(R, name, id, u, v, scale));
}

// Bands: speckle darkened on every `every`-th texel column: feathers, planks, cloth.
function bands(R, name, pal, scale = 3, every = 4) {
  return (face, u, v, id) => pick(pal, texel(R, name, id, u, v, scale) * 0.7 + (u % every === 0 ? 0 : 0.3));
}

module.exports = {
  SHADE, PAL, shaded, hazed, iso, world, depth, face, drawBoxes, slab,
  pick, texel, grassTexture, dirtTexture, logTexture, speckle, bands,
};
