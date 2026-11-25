// pattern -- one motif, repeated by a wallpaper group named by its Conway
// orbifold signature. A still, plotter-bound, and the whole of its structure is
// a GROUP rather than a field or a recursion.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other piece here
// PLACES its marks: a walker travels, a field is sampled, a rectangle is cut.
// Here one motif is designed and every other mark on the sheet is IMPLIED --
// it is what the symmetry says must also be true. That inverts two things the
// rest of the library never has to face. Arithmetic drift becomes visible:
// tiling is the one idiom where a coordinate wrong in the sixth decimal shows
// up as a seam, so the group is carried in LATTICE coordinates where every
// operation is integers and halves and nothing rounds. And the orbit is
// redundant on purpose -- every cell stamps every coset of the motif -- so the
// piece has to know what that costs instead of assuming it: three quarters of
// what it stamps falls outside the panel and is clipped away, and both counts
// are published so the ratio can be read off a solve.
//
// THE ART DIRECTION, WHICH IS THE PART NO CHECK CATCHES. A wallpaper swatch is
// uniform algorithmic attention with a name on it: seventeen groups and not one
// of them says where to look. So the SYMMETRY is exact and the ILLUMINATION is
// not. Every repeat is an exact image of its neighbours; how heavily a repeat is
// inked is decided per lattice node by a focus the group knows nothing about.
// Near the focus the motif is drawn in full, doubled into a band, in the dark
// pen; away from it only the first arms survive, single, in the let-down pen.
// A tile panel glazed by hand does the same thing and nobody calls it a broken
// pattern.
//
// The seventeen groups live in THIS FILE, not in core/. A symmetry table is a
// subject if anything is -- it assumes the art is ornament on a lattice. It
// moves when a second piece needs it, and not before. N4.

'use strict';

const { rng, noise2 } = require('../core/rand.js');
const { clamp01, pick, smoothstep } = require('../core/num.js');
const { ring, offsetPolyline, segmentIntersection } = require('../core/geom.js');
const { stroke, fill, clipPolyline, boxOf } = require('../core/path.js');
const { mix } = require('../core/colour.js');

const W = 960;
const H = 1200;
const M = 72;

// Stated as art direction, not as machinery: a panel, four pens and no more,
// because four pens is what a plotter can actually be loaded with. A warm rag
// paper, the dark pen that carries the drawing, the same pen let down with
// paper for everything the eye is not meant to stop on, and one warm accent
// spent on a handful of marks. The let-down pen is mixed IN LINEAR LIGHT, so it
// sits where the light between ink and paper actually is rather than where
// their numbers average.
const PAPER = '#f2ece0';
const INK = '#1b222e';
const ACCENT = '#b8432a';
const SKELETON = mix(INK, PAPER, 0.46);

// ---------------------------------------------------------------------------
// The seventeen wallpaper groups, by Conway orbifold signature.
//
// A group is a LATTICE plus a set of coset representatives, and both are
// written in lattice coordinates: the position u*a + v*b for basis vectors a
// and b. That choice is the whole trick. In cartesian coordinates a sixth turn
// carries sqrt(3)/2 and a hexagonal mirror carries it twice, so copies that
// must meet arrive a rounding apart and the tiling grows seams. In lattice
// coordinates every one of the operations below is integers and halves --
// exact in binary floating point, composable without drift, and readable.
//
// A transform is [a, b, c, d, e, f], meaning u' = a*u + b*v + e and
// v' = c*u + d*v + f. Translations by whole cells are not listed: they are the
// lattice, and the stamping loop walks them.
const LATTICES = {
  // A rectangle, a square, a rhombus (the primitive cell of the centred
  // rectangular lattice) and the hexagonal 60-degree pair.
  rect: [[1, 0], [0, 1.28]],
  square: [[1, 0], [0, 1]],
  rhombic: [[1, 0.62], [1, -0.62]],
  hex: [[1, 0], [0.5, Math.sqrt(3) / 2]],
};

const IDENTITY = [1, 0, 0, 1, 0, 0];
const HALF_TURN = [-1, 0, 0, -1, 0, 0];      // every lattice
const MIRROR_U = [-1, 0, 0, 1, 0, 0];        // reflect across the b axis
const MIRROR_V = [1, 0, 0, -1, 0, 0];        // reflect across the a axis
const GLIDE_B = [-1, 0, 0, 1, 0, 0.5];       // reflect, then slide half of b
const GLIDE_A = [1, 0, 0, -1, 0.5, 0];       // reflect, then slide half of a
const GLIDE_XX = [1, 0, 0, -1, 0.5, 0.5];    // the second glide of pgg
const SWAP = [0, 1, 1, 0, 0, 0];             // reflect across the long diagonal
const QUARTER_TURN = [0, -1, 1, 0, 0, 0];    // square lattice only
const GLIDE_DIAG = [0, 1, 1, 0, 0.5, 0.5];   // p4g's diagonal glide
const SIXTH_TURN = [0, -1, 1, 1, 0, 0];      // hexagonal lattice only
const THIRD_TURN = [-1, -1, 1, 0, 0, 0];     // = SIXTH_TURN squared
const MIRROR_HEX = [1, 1, 0, -1, 0, 0];      // hexagonal, across the a axis

// Generators only. `cosets()` closes them, so a typo here becomes a group of
// the wrong order rather than a picture that is subtly not a tiling.
//
// *333 and 3*3 differ by ONE generator and by nothing else, which is the pair
// most often got wrong: SWAP fixes the line u = v, which carries all three
// three-fold centres, so every one of them lands on a mirror -- *333. MIRROR_HEX
// fixes v = 0, which carries only the one at the origin, leaving the other two
// as gyrations off the mirror -- 3*3.
const GROUPS = {
  o: { lattice: 'rect', gens: [] },                             // p1
  xx: { lattice: 'rect', gens: [GLIDE_B] },                     // pg
  '*x': { lattice: 'rhombic', gens: [SWAP] },                   // cm
  '**': { lattice: 'rect', gens: [MIRROR_U] },                  // pm
  2222: { lattice: 'rect', gens: [HALF_TURN] },                 // p2
  333: { lattice: 'hex', gens: [THIRD_TURN] },                  // p3
  '22x': { lattice: 'rect', gens: [HALF_TURN, GLIDE_XX] },      // pgg
  '22*': { lattice: 'rect', gens: [HALF_TURN, GLIDE_A] },       // pmg
  '*2222': { lattice: 'rect', gens: [MIRROR_U, MIRROR_V] },     // pmm
  '2*22': { lattice: 'rhombic', gens: [SWAP, HALF_TURN] },      // cmm
  442: { lattice: 'square', gens: [QUARTER_TURN] },             // p4
  '*333': { lattice: 'hex', gens: [THIRD_TURN, SWAP] },         // p3m1
  '3*3': { lattice: 'hex', gens: [THIRD_TURN, MIRROR_HEX] },    // p31m
  632: { lattice: 'hex', gens: [SIXTH_TURN] },                  // p6
  '4*2': { lattice: 'square', gens: [QUARTER_TURN, GLIDE_DIAG] }, // p4g
  '*442': { lattice: 'square', gens: [QUARTER_TURN, SWAP] },    // p4m
  '*632': { lattice: 'hex', gens: [SIXTH_TURN, SWAP] },         // p6m
};

// Written out rather than taken from GROUPS, for two reasons. It is ordered by
// how much symmetry the group has, so the parameter that selects one is a knob
// and not a lookup table -- sweeping it adds symmetry rather than jumping
// between unrelated pictures. And Object.keys would not have given this order
// anyway: '333', '442', '632' and '2222' are array indices as far as JavaScript
// is concerned, so they sort themselves to the front, numerically, ahead of the
// insertion order everything else keeps.
const SIGNATURES = [
  'o', 'xx', '*x', '**', '2222', '333', '22x', '22*', '*2222',
  '2*22', '442', '*333', '3*3', '632', '4*2', '*442', '*632',
];

if (SIGNATURES.length !== Object.keys(GROUPS).length) {
  throw new Error('pattern: the signature list and the group table disagree');
}

/** Compose two lattice transforms: the result applies `b` first, then `a`. */
function compose(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[0] * b[4] + a[1] * b[5] + a[4],
    a[2] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Drop whole-cell translation: that part is the lattice, walked separately. */
function reduce(m) {
  const wrap = (x) => ((x % 1) + 1) % 1;
  return [m[0], m[1], m[2], m[3], wrap(m[4]), wrap(m[5])];
}

/**
 * The coset representatives of a signature: the group modulo its translations.
 *
 * A breadth-first closure of the generators, deduplicated on the exact transform
 * -- exact because every entry is an integer or a half. The order that comes out
 * is the check on the table above: 1, 2, 3, 4, 6, 8 or 12, and never anything
 * else. The cap is not a safety net for input, it is a tripwire for a mistyped
 * generator, which would otherwise close into an infinite group and hang.
 */
function cosets(sig) {
  const group = GROUPS[sig];
  if (!group) throw new Error(`pattern: unknown orbifold signature ${JSON.stringify(sig)}`);
  const out = [IDENTITY];
  const seen = new Set([IDENTITY.join()]);
  for (let i = 0; i < out.length; i++) {
    for (const g of group.gens) {
      const m = reduce(compose(g, out[i]));
      const k = m.join();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
      if (out.length > 24) throw new Error(`pattern: ${sig} does not close -- check its generators`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The motif.
//
// Every arm runs between points of the HALF-LATTICE, and that is not a
// decoration of the design -- it is what makes the sheet one drawing instead of
// a grid of stamps. Every transform in the table has an integer linear part and
// a translation in halves, so it maps a half-integer point to a half-integer
// point exactly. Anchor the ends there and the images of an arm meet the images
// of its neighbours end to end, across cell walls, in all seventeen groups.
const CHORDS = [
  [[0.5, 0], [0, 0.5]],       // the quarter turn at the cell's own corner
  [[0.5, 0], [1, 0.5]],       // and at the next corner along
  [[0, 0.5], [0.5, 1]],
  [[1, 0.5], [0.5, 1]],
  [[0.5, 0], [0.5, 1]],       // straight across, to be bowed
  [[0, 0.5], [1, 0.5]],
  [[0, 0], [0.5, 0.5]],       // node to centre: the spoke
  [[0.5, 0.5], [1, 1]],
  [[0, 0], [0.5, 0]],         // a short run along the cell wall
  [[0, 0], [0, 0.5]],
  [[0.5, 0.5], [0.5, 0]],
  [[0.5, 0.5], [0, 0.5]],
];

const SAMPLES = 11;   // points along one arm; a bowed chord needs no smoothing
const BAND = 0.038;   // half-width of a doubled arm, in cell widths

/**
 * One arm: a chord of the half-lattice, bowed, as a centre line and as the pair
 * of lines that make it a band.
 *
 * Bowed in LATTICE coordinates, deliberately. A bow measured in cartesian would
 * have to be re-measured after every transform, and a reflection would then bow
 * the copy the same way round as the original instead of the other way -- the
 * copies would look symmetric and not be. Bowing here, once, before any
 * transform, makes every copy an exact affine image of the one motif. On a
 * sheared lattice the bow shears with it, which is how a hexagonal ornament is
 * supposed to sit.
 */
function arm(a, b, bow) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const solo = [];
  for (let i = 0; i < SAMPLES; i++) {
    const s = i / (SAMPLES - 1);
    const swell = Math.sin(Math.PI * s) * bow;
    solo.push([a[0] + dx * s - dy * swell, a[1] + dy * s + dx * swell]);
  }
  // The band is the PAIR, not the centre line thickened: a set that is
  // symmetric about the arm stays symmetric under a reflection, so a doubled
  // arm is still an exact image of its neighbour.
  // Constant perpendicular distance from each sampled segment, before the
  // lattice transform. Keep the established width proportional to chord length.
  const width = BAND * Math.hypot(dx, dy);
  return { solo, band: [offsetPolyline(solo, width), offsetPolyline(solo, -width)] };
}

/** Pin a bead to the nearest visible crossing within a fifth of a cell. */
function accentCrossing(node, paths, radius) {
  const segs = [];
  for (const path of paths) {
    if (path.tier !== 2) continue;
    for (let i = 1; i < path.pts.length; i++) {
      const a = path.pts[i - 1]; const b = path.pts[i];
      if (Math.max(a[0], b[0]) < node.x - radius || Math.min(a[0], b[0]) > node.x + radius
        || Math.max(a[1], b[1]) < node.y - radius || Math.min(a[1], b[1]) > node.y + radius) continue;
      segs.push({ a, b, path });
    }
  }
  let point = [node.x, node.y]; let nearest = radius;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]; const b = segs[j];
      if (a.path === b.path) continue;
      const hit = segmentIntersection(a.a, a.b, b.a, b.b);
      if (!hit || hit.type !== 'point') continue;
      const d = Math.hypot(hit.point[0] - node.x, hit.point[1] - node.y);
      if (d < nearest) { nearest = d; point = hit.point; }
    }
  }
  return point;
}

module.exports = {
  name: 'pattern',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 31,
  params: {
    group: {
      min: 0, max: 16, value: 13,
      meaning: 'which of the seventeen wallpaper symmetries repeats the motif, plainest first',
    },
    cell: {
      min: 90, max: 260, value: 172,
      meaning: 'how wide one repeat is, and so how many repeats cross the sheet',
    },
    arms: {
      min: 2, max: 6, value: 4,
      meaning: 'how many strokes the motif is drawn with before the symmetry answers it',
    },
    bloom: {
      min: 0.4, max: 3, value: 1.15,
      meaning: 'how far the heavy ink reaches from the focus before the field thins to a skeleton',
    },
  },

  state: () => ({ sig: 'o', paths: [], accents: [], stamped: 0 }),

  build: [
    ['name the group', (s) => {
      s.sig = SIGNATURES[Math.round(s.params.group)];
      s.cosets = cosets(s.sig);
      s.order = s.cosets.length;
      s.basis = LATTICES[GROUPS[s.sig].lattice];
    }],

    ['cut the motif', (s) => {
      const R = rng(s.seed);
      const n = Math.round(s.params.arms);
      // Drawn without replacement, so an arm is never laid exactly over its
      // twin: a repeated chord costs a pen pass and adds nothing.
      const rest = CHORDS.slice();
      const chosen = [];
      for (let i = 0; i < n && rest.length; i++) {
        const c = pick(rest, R('arm', 'chord', i));
        rest.splice(rest.indexOf(c), 1);
        chosen.push({ c, bow: (R('arm', 'bow', i) - 0.5) * 0.52 });
      }
      // Shortest arm first, and the order is what the sheet spends its ink on:
      // a quiet node draws only the low ranks. So the skeleton that covers most
      // of the paper is made of the short, cell-local arms, and the long sweeps
      // that cross into the neighbours are a luxury of the lit region. Ranking
      // them the other way round leaves isolated tendrils lying in empty paper.
      chosen.sort((a, b) => Math.hypot(a.c[1][0] - a.c[0][0], a.c[1][1] - a.c[0][1])
        - Math.hypot(b.c[1][0] - b.c[0][0], b.c[1][1] - b.c[0][1]));
      s.motif = chosen.map((a) => arm(a.c[0], a.c[1], a.bow));
    }],

    ['weigh the sheet', (s) => {
      const R = rng(s.seed);
      const size = s.params.cell;
      const B = s.basis;

      // Two separate causes, kept separate on purpose. WHERE the ink gathers is
      // compositional -- distance from a seeded focus, which decides where the
      // eye goes. HOW the edge of that pool falls is morphological -- its own
      // named noise field. One source doing both is what makes a picture look
      // like one algorithm, and here it would also make the pool a circle.
      s.focus = [(0.24 + R('focus', 'x') * 0.5) * W, (0.2 + R('focus', 'y') * 0.44) * H];
      // Off the lattice by a seeded fraction of a cell, so the sheet is never
      // cropped through the same part of the pattern twice.
      s.origin = [W / 2 + (R('sheet', 'x') - 0.5) * size, H / 2 + (R('sheet', 'y') - 0.5) * size];

      const det = B[0][0] * B[1][1] - B[1][0] * B[0][1];
      let uLo = Infinity; let uHi = -Infinity; let vLo = Infinity; let vHi = -Infinity;
      for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        const dx = (x - s.origin[0]) / size;
        const dy = (y - s.origin[1]) / size;
        const u = (B[1][1] * dx - B[1][0] * dy) / det;
        const v = (B[0][0] * dy - B[0][1] * dx) / det;
        uLo = Math.min(uLo, u); uHi = Math.max(uHi, u);
        vLo = Math.min(vLo, v); vHi = Math.max(vHi, v);
      }

      const reach = W * 0.52 * s.params.bloom;
      s.nodes = [];
      for (let j = Math.floor(vLo) - 2; j <= Math.ceil(vHi) + 2; j++) {
        for (let i = Math.floor(uLo) - 2; i <= Math.ceil(uHi) + 2; i++) {
          const x = s.origin[0] + size * (i * B[0][0] + j * B[1][0]);
          const y = s.origin[1] + size * (i * B[0][1] + j * B[1][1]);
          const want = smoothstep(reach, reach * 0.18, Math.hypot(x - s.focus[0], y - s.focus[1]));
          const weather = noise2(R, x / 260, y / 260, 'weather');
          const heat = clamp01(want * 0.82 + (weather - 0.5) * 0.55);
          s.nodes.push({ i, j, x, y, heat, tier: heat > 0.58 ? 2 : heat > 0.21 ? 1 : 0 });
        }
      }
    }],

    ['stamp the group', (s) => {
      const size = s.params.cell;
      const B = s.basis;
      const box = boxOf({ w: W, h: H }, M);
      const arms = s.motif.length;
      // The motif covers the whole cell rather than one fundamental domain, so
      // the orbit is redundant: every coset image of an arm is drawn, and
      // neighbouring cells cover the same paper again. A fold of identical
      // strokes was written here first, on the assumption that a plotter would
      // otherwise pay for the same pass twice. Measured, it folded one stroke in
      // fifteen hundred and was deleted. A bowed arm lying along a mirror is not
      // its own mirror image -- the bow goes the other way -- so the cases the
      // fold existed for do not arise. What DOES cost is the margin below: about
      // three quarters of what is stamped falls outside the panel and is clipped
      // away, and both counts are published so that stays visible.
      s.stamped = 0;
      s.paths = [];
      const drawn = [];

      for (const node of s.nodes) {
        const budget = node.tier === 2 ? arms
          : Math.max(1, Math.round(arms * (node.tier === 1 ? 0.75 : 0.5)));
        for (let a = 0; a < budget; a++) {
          const lines = node.tier === 2 ? s.motif[a].band : [s.motif[a].solo];
          for (const line of lines) {
            for (const m of s.cosets) {
              s.stamped++;
              const pts = line.map(([u, v]) => {
                const tu = m[0] * u + m[1] * v + m[4] + node.i;
                const tv = m[2] * u + m[3] * v + m[5] + node.j;
                return [
                  s.origin[0] + size * (tu * B[0][0] + tv * B[1][0]),
                  s.origin[1] + size * (tu * B[0][1] + tv * B[1][1]),
                ];
              });
              drawn.push({ pts, tier: node.tier });
            }
          }
        }
      }

      // Clipped at the frame, not faded out at it. Wallpaper has no edge; a
      // panel of it does, and the panel's edge is a cut.
      for (const { pts, tier } of drawn) {
        for (const run of clipPolyline(pts, box)) s.paths.push({ pts: run, tier });
      }
      s.paths.sort((a, b) => a.tier - b.tier);
    }],

    ['set the accents', (s) => {
      const R = rng(s.seed);
      const size = s.params.cell;
      // FIVE EXCELLENT MARKS BEAT FIFTY EQUIVALENT ONES. The one warm pen is
      // spent on the six hottest nodes and nowhere else, so it reads as a
      // decision rather than as a third texture.
      const hot = s.nodes
        .filter((n) => n.tier === 2 && n.x > M + size * 0.2 && n.x < W - M - size * 0.2
          && n.y > M + size * 0.2 && n.y < H - M - size * 0.2)
        .sort((a, b) => b.heat - a.heat || a.j - b.j || a.i - b.i)
        .slice(0, 6);
      // Keep the chosen hot nodes and palette; move each bead onto nearby ink
      // intersections. A node without a local crossing keeps its old anchor.
      s.accentCentres = hot.map((n) => accentCrossing(n, s.paths, size * 0.2));
      s.accents = hot.map((n, i) => ring(...s.accentCentres[i], 18,
        (ang) => size * (0.048 + 0.012 * noise2(R, Math.cos(ang) + n.i, Math.sin(ang) + n.j, 'bead'))));
    }],
  ],

  draw(g, s) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    g.lineJoin = 'round';
    g.lineCap = 'round';

    // One pass per pen, in the order a plotter would load them: everything the
    // let-down pen draws, then everything the dark pen draws, then the accent.
    const PENS = [
      { ink: SKELETON, weight: 0.7 },
      { ink: INK, weight: 0.95 },
      { ink: INK, weight: 1.45 },
    ];
    for (let tier = 0; tier < PENS.length; tier++) {
      g.strokeStyle = PENS[tier].ink;
      g.lineWidth = PENS[tier].weight;
      for (const p of s.paths) if (p.tier === tier) stroke(g, p.pts);
    }

    g.fillStyle = ACCENT;
    for (const bead of s.accents) fill(g, bead);

    g.strokeStyle = INK;
    g.lineWidth = 1.4;
    g.beginPath();
    g.rect(M, M, W - 2 * M, H - 2 * M);
    g.stroke();
  },
};
