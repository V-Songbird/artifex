// lsystem -- a grammar and a turtle. A still, vector-bound, one closed boundary.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other example in
// this repository computes coordinates: a field is sampled, a lattice is
// walked, a rectangle is cut, a candidate form is proposed and tested, a
// dataset is laid along a baseline. This one computes a WORD -- a sequence of
// symbols over an alphabet of three -- and the coordinates are whatever a
// turtle gets when it reads that word out loud. A library that quietly assumes
// geometry arrives AS geometry fails here, at the first line of the build.
//
// IT IS NOT A PLANT, AND THAT IS THE POINT. The famous output of an L-system is
// a branching tree, and this project has already paid once for an engine that
// drew one kind of picture seven times. The grammar here is a quadratic Koch
// family over right angles: a closed boundary that crenellates out of itself
// and into itself, and reads as a coastline, a fortification plan or a pad on a
// board -- anything except foliage.
//
// The grammar and the turtle live here, not in core/, for the same reason the
// stroke font does: one example reaches them. N4.

'use strict';

const { rng, gradient2 } = require('../core/rand.js');
const { clamp01, pick } = require('../core/num.js');
const { bbox, chaikin, resample } = require('../core/geom.js');
const { stroke, fill } = require('../core/path.js');
const { mix } = require('../core/colour.js');

const W = 900;
const H = 900;
const M = 95;

// THE GRAMMAR DOES NOT KNOW HOW BIG THE PAPER IS. Run lengths are axiom units,
// the axiom square is one unit on a side, and the finished ring is fitted to
// the sheet at the very end. An outward cape can extend a third of the axiom
// width, so fitting before expansion would crop the finished form.
const MIN_RUN = 0.0035;   // a production makes five of these; below it, stop
const ROUND = 2.6;        // how hard the corners are cut, in paper pixels
const SPACING = 1.2;      // how densely the finished line is described

// Art direction, not machinery. The mass is the dark one: a pale figure on this
// grammar washed out and the crenellation -- the only thing the piece is about
// -- stopped reading at a metre. So a warm paper, a slate mass that holds the
// silhouette, a near-black that rims it so the edge is DRAWN rather than merely
// where the fill stops, and one hot accent used exactly once, because a second
// use would turn it into texture.
const PAPER = '#efe7d8';
const LAND = '#39414a';
const INK = '#12141a';
const ACCENT = '#e2612a';

// The two productions a run can take. Both are five runs at a third of the
// parent's length, both leave the turtle facing the way it came in, and both
// end exactly where the parent ended -- which is what keeps the boundary closed
// however the choices fall. `+` is a quarter turn left, `-` a quarter turn
// right, and the axiom is walked clockwise with the enclosed area on the right,
// so OUT pushes the detour away from that area and IN pulls it inside.
const OUT = 'F+F-F-F+F';
const IN = 'F-F+F+F-F';

module.exports = {
  name: 'lsystem',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 37,
  params: {
    // CAPPED, because the word grows by five for every pass and nothing in a
    // rewriting system asks whether the next one is affordable. Five is also
    // where a run meets MIN_RUN: a sixth pass would multiply the word by five
    // to draw detail no pen could hold apart.
    depth: { min: 1, max: 5, value: 4,
      meaning: 'how fine the boundary is allowed to crenellate before it is drawn' },
    focus: { min: 0.7, max: 2.8, value: 1.5,
      meaning: 'how tightly the fine detail gathers at one place, leaving the rest of the edge plain' },
    lobe: { min: 0.08, max: 0.55, value: 0.22,
      meaning: 'how broad the inward bays and outward capes of the boundary become' },
  },

  state: () => ({
    focus: [0, 0], eye: [0, 0], ring: [], ghost: [], focal: [],
    runs: 0, points: 0, word: null, first: null,
  }),

  build: [
    ['place the eye', (s) => {
      const R = rng(s.seed);
      // ON the perimeter, not in the middle of it. Every point of a square ring
      // is about the same distance from its centre, so a focus at the centre
      // makes detail fall away by the same amount in every direction, which is
      // the same non-decision as having no focus at all.
      const a = 0.2 + R('focus', 'along') * 0.6;
      s.focus = pick([[a, 0], [1, a], [a, 1], [0, a]], R('focus', 'edge'));
    }],

    ['rewrite the word', (s) => {
      const R = rng(s.seed);
      const passes = Math.round(s.params.depth);
      const tight = s.params.focus;
      const scale = s.params.lobe;
      const fx = s.focus[0];
      const fy = s.focus[1];

      let word = axiom();

      for (let p = 0; p < passes; p++) {
        // The turtle runs BEFORE each pass, not only at the end, because the
        // next question is where each run sits on the sheet. That is the whole
        // compositional mechanism and it costs one linear walk per pass.
        const mid = walk(word).mid;
        const next = [];
        let f = 0;

        for (const sym of word) {
          if (sym.c !== 'F') { next.push(sym); continue; }
          const at = mid[f++];
          if (sym.len < MIN_RUN * 3) { next.push(sym); continue; }

          // COMPOSITIONAL -- how much subdivision this part of the sheet has
          // earned, from its distance to the eye. The floor is not zero: a
          // quiet stretch of boundary is a plain line with the occasional
          // incident on it, and a line that can never move is a ruler.
          //
          // The first pass is not negotiable for the same reason. An axiom run
          // is one whole side of the square, and leaving one alone leaves a
          // drawn ruler in the picture.
          const away = Math.hypot(at[0] - fx, at[1] - fy);
          const want = p === 0 ? 1 : 0.16 + 0.84 * clamp01(1.05 - away * tight);

          // ADDRESSED, AND THE ADDRESS IS THE PATH THROUGH THE DERIVATION --
          // never the index in the word. An index is a stream wearing different
          // clothes: give one earlier run a nine-symbol production instead of
          // leaving it at one symbol and every index behind it shifts, so every
          // later run re-rolls and the whole boundary changes. So each run
          // carries an address folded from its parent's address and its own
          // offset inside the parent's production, and two derivations that
          // differ somewhere else hand this run the same address and therefore
          // the same production. Through five passes the fold never wraps (see
          // `child`), so no two runs in a word can share an address.
          //
          // The PASS is in the property and not in the address, and it has to
          // be: a run left alone at pass two keeps its address, so without it
          // the same roll would come back and a run turned down once would be
          // turned down for ever. The boundary would then be either fully
          // rewritten or untouched, with none of the middle.
          if (R('rule', `F@${p}`, sym.addr) >= want) { next.push(sym); continue; }

          // MORPHOLOGICAL -- which side the detour falls on, from a field of
          // its own. Kept apart from the cause above on purpose: one source
          // deciding both where the detail goes AND which way it bends is what
          // makes a picture look like a single algorithm. Gradient noise rather
          // than value noise, because what is wanted is coherent regions of bay
          // and cape rather than a lattice of them.
          const prod = gradient2(R, at[0] / scale, at[1] / scale, 'lobe') > 0.46 ? OUT : IN;
          const len = sym.len / 3;
          for (let k = 0; k < prod.length; k++) {
            const c = prod[k];
            next.push(c === 'F' ? { c, len, addr: child(sym.addr, k) } : { c, len: 0, addr: 0 });
          }
        }

        word = next;
        // The form after one rewrite, kept so the picture can say that the
        // boundary was DERIVED rather than drawn.
        if (p === 0) s.first = word;
      }

      s.word = word;
      s.runs = word.reduce((n, sym) => n + (sym.c === 'F' ? 1 : 0), 0);
    }],

    ['fit it to the sheet', (s) => {
      const raw = ring(s.word);
      const box = bbox(raw);
      const k = Math.min((W - 2 * M) / (box[2] - box[0]), (H - 2 * M) / (box[3] - box[1]));
      const ox = (W - (box[2] - box[0]) * k) / 2 - box[0] * k;
      const oy = (H - (box[3] - box[1]) * k) / 2 - box[1] * k;
      const onto = (pts) => pts.map((p) => [p[0] * k + ox, p[1] * k + oy]);

      s.eye = [s.focus[0] * k + ox, s.focus[1] * k + oy];
      s.ring = smooth(onto(raw), ROUND, SPACING);
      s.ghost = smooth(onto(ring(s.first)), ROUND * 3, SPACING * 4);
      s.points = s.ring.length;
      s.focal = focalArc(s.ring, s.eye, W * 0.17);

      // The words were scaffolding. What this piece publishes is the boundary,
      // and carrying tens of thousands of symbols past the stage that consumed
      // them makes every later inspection of the state slower for nothing.
      s.word = null;
      s.first = null;
    }],
  ],

  draw(g, s) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    // The mass before the edge. A closed word is an AREA before it is a line,
    // and a boundary cannot be read as a boundary until it has two sides.
    g.fillStyle = LAND;
    fill(g, s.ring);

    g.strokeStyle = INK;
    g.lineWidth = 1.2;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    stroke(g, s.ring, true);

    // What the grammar started from, over the top and BROKEN. Solid it read as
    // a second boundary that had gone wrong; dashed it reads as what it is, a
    // construction line, and it is the only mark in the picture that says the
    // edge came from somewhere. It is also the only one that crosses the
    // silhouette instead of bounding it.
    g.setLineDash([7, 6]);
    g.strokeStyle = mix(PAPER, INK, 0.5);
    g.lineWidth = 0.9;
    stroke(g, s.ghost, true);
    g.setLineDash([]);

    // One mark, heavier and hot, exactly where the rewriting went deepest.
    g.strokeStyle = ACCENT;
    g.lineWidth = 2.6;
    stroke(g, s.focal);
  },
};

// The axiom: a square walked clockwise, one run to a side, a quarter turn right
// at each corner.
function axiom() {
  const w = [];
  for (let i = 0; i < 4; i++) {
    w.push({ c: 'F', len: 1, addr: i + 1 });
    w.push({ c: '-', len: 0, addr: 0 });
  }
  return w;
}

/**
 * Fold a run's address together with its offset inside its parent's production.
 *
 * Multiplying by 31 and adding an offset below 31 is injective, and with nine
 * symbols to a production and five passes the largest address reachable is
 * about 1.2e8 -- an order of magnitude under 2^31, so nothing wraps and no two
 * runs in a word can collide.
 */
function child(addr, k) {
  return (Math.imul(addr, 31) + k + 1) | 0;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * The turtle. Reads the word left to right: a turn costs nothing, and every F
 * lays down a run of its OWN length.
 *
 * Its own length, not a shared step, is what makes variable depth possible at
 * all. A run that stopped rewriting three passes ago is still a third of the
 * axiom wide while its neighbour is a two-hundredth; one global step would draw
 * both the same and tear the boundary open.
 *
 * It hands back the midpoint of each run as well as the polyline, because the
 * next rewrite pass asks where each run is before deciding what to do with it.
 */
function walk(word) {
  let x = 0;
  let y = 0;
  let d = 0;
  const pts = [[x, y]];
  const mid = [];
  for (const sym of word) {
    if (sym.c === '+') { d = (d + 3) & 3; continue; }
    if (sym.c === '-') { d = (d + 1) & 3; continue; }
    const nx = x + DX[d] * sym.len;
    const ny = y + DY[d] * sym.len;
    mid.push([(x + nx) / 2, (y + ny) / 2]);
    x = nx;
    y = ny;
    pts.push([x, y]);
  }
  return { pts, mid };
}

// The turtle comes back to where it started, so its last point is its first. A
// ring says that once and lets the closing be the closing.
function ring(word) {
  const pts = walk(word).pts;
  pts.pop();
  return pts;
}

/**
 * Space, cut, space again. The two spacings are two different decisions and the
 * order was settled by looking.
 *
 * Chaikin cuts each corner in proportion to the runs that made it. Run straight
 * off the turtle, with a whole side of the axiom at one end of the range and
 * two pixels at the other, that rounded the coarse structure into soft lobes
 * and left the picture a blob with a few curls on it -- the orthogonal
 * character the entire grammar is about, gone. Resampling FIRST caps the
 * rounding at `round` everywhere: the coarse runs keep their right angles with
 * a drawn softness on them, and the finest crenellation, only a couple of
 * pixels across, rounds most of the way into a ripple. That is the same
 * hierarchy the rewriting built, the right way up.
 *
 * Resampling again afterwards is a separate job. Corner cutting multiplies the
 * point count by four while adding nothing along the straight runs, and the
 * focal arc below asks a distance question PER POINT -- an answer that has to
 * be at one resolution, or the ends of the arc land wherever the points happen
 * to be dense. One pass off the second resample is a third of the file size of
 * the same picture.
 */
function smooth(pts, round, spacing) {
  const even = resample(pts, round, true);
  even.pop();
  const out = resample(chaikin(even, 2, true), spacing, true);
  out.pop();
  return out;
}

/**
 * The one stretch of the ring that passes closest to the eye and stays within
 * `rad` of it.
 *
 * ONE, deliberately. A plain radius test over the whole ring hands back a dozen
 * fragments wherever the boundary weaves in and out of the disc, and a dozen
 * emphatic fragments is not an emphasis, it is a texture. So this finds the
 * single nearest point and walks outwards from it in both directions until the
 * boundary leaves the disc.
 */
function focalArc(pts, eye, rad) {
  const n = pts.length;
  const d2 = (i) => {
    const p = pts[((i % n) + n) % n];
    return (p[0] - eye[0]) ** 2 + (p[1] - eye[1]) ** 2;
  };
  let near = 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = d2(i);
    if (d < best) { best = d; near = i; }
  }
  const r2 = rad * rad;
  let a = near;
  let b = near;
  while (b - a < n - 1 && d2(a - 1) < r2) a--;
  while (b - a < n - 1 && d2(b + 1) < r2) b++;
  const out = [];
  for (let i = a; i <= b; i++) out.push(pts[((i % n) + n) % n]);
  return out;
}
