// packing -- closed forms grown until they touch. A still, plotter-bound, and
// the only piece in the set whose composition is decided by REFUSAL: nothing
// here is placed, things are proposed and most of them are turned away.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. The other five all know
// where their marks go before they make them -- a grid, a lattice, a flow, a
// recursion, a baseline. This one does not: a form's size is whatever the forms
// already there have left it, so the picture is a function of the ORDER in which
// candidates were tried. That is the assumption a library built around fields
// and lattices never has to face, and it is the one every packing, scattering,
// relaxation and growth idiom is built on.
//
// It is also where the shape vocabulary in core/geom.js earns its place: a form
// is a ring whose radius is a field, the ring is smoothed, the outline is a
// ribbon so a single-width pen can still taper, and whether a candidate is
// already inside something is a point-in-polygon test. See
// ../Docs/Artifex/peer-implementation-scan.md for where that list came from.
//
// THE ONE PIECE OF ART DIRECTION, STATED. Each form is printed twice, in two
// inks, a fraction of a millimetre apart. That is misregistration -- the thing
// that makes a print read as a print rather than as a render -- and it lives
// here, in an example, rather than in core. N2: it is a look, and a look is the
// author's to choose. If a second piece needs it, it moves.

'use strict';

const { rng, fbm } = require('../core/rand.js');
const { clamp01, lerp, pick } = require('../core/num.js');
const { mix } = require('../core/colour.js');
const { poly, stroke, clipPolyline, boxOf } = require('../core/path.js');
const {
  ring, chaikin, resample, ribbon, centroid, pointInPoly, bbox, lengthOf,
} = require('../core/geom.js');

const W = 900;
const H = 1150;
const M = 70;

// Art direction, not machinery: a warm ground and a small ink set, two of which
// are close enough to read as one colour printed twice out of alignment. N2.
const PAPER = '#f2ece0';
const INKS = ['#1d2b3a', '#c8452f', '#2d7d6e', '#d8a13c'];

// How far the second impression sits from the first, in design units. Small
// enough to read as a printing fault rather than as two drawings.
const SLIP = 2.2;

const TRIES = 2600;          // candidates proposed, not forms placed
const MIN_R = 7;
const MAX_R = 92;

module.exports = {
  name: 'packing',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 31,
  params: {
    relax: { min: 0, max: 1, value: 0.34 },     // how much air is left between forms
    lobes: { min: 0, max: 1, value: 0.55 },     // round forms at 0, deeply folded at 1
    shells: { min: 1, max: 6, value: 3 },       // concentric rings inside each form
  },

  state: () => ({ forms: [], tried: 0, placed: 0 }),

  build: [
    ['propose and refuse', (s) => {
      const R = rng(s.seed);
      const box = boxOf({ w: W, h: H }, M);
      const gap = lerp(0.5, 9, s.params.relax);
      const placed = [];

      // TWO CAUSES, KEPT SEPARATE, the same way partition keeps them apart.
      //
      //   the budget  shrinks as the run goes on, so a big form gets its chance
      //               before the sheet is full. A packing that takes candidates
      //               in arrival order fills with middling forms and never finds
      //               room for a large one -- which is why so much scattered
      //               work has no scale hierarchy at all.
      //   the grain   a field that says how large forms want to be HERE. Without
      //               it the sheet is evenly busy everywhere, and evenly busy is
      //               not a composition, it is an absence of one.
      //
      // A UNIFORM GRID, BECAUSE THE NAIVE LOOP IS THE WHOLE COST. Testing every
      // candidate against every form already placed is O(tries x placed): 2600
      // proposals against nine hundred forms is 2.3 million distance checks, and
      // a profile put 31% of this piece's entire render inside that one loop.
      //
      // A form can only constrain a candidate if it is within
      // `budget + MAX_R + gap` of it, so with cells one MAX_R across the search
      // is a small square of cells and nothing outside it is ever touched. The
      // bound is deliberately generous -- a packing that misses a neighbour
      // overlaps, and an overlap is the one fault this idiom cannot hide.
      const CELL = MAX_R;
      const grid = new Map();
      const keyOf = (cx, cy) => cx * 100003 + cy;
      const add = (f) => {
        const k = keyOf(Math.floor(f.x / CELL), Math.floor(f.y / CELL));
        const cell = grid.get(k);
        if (cell) cell.push(f); else grid.set(k, [f]);
      };

      // One source doing both makes a picture look like one algorithm.
      for (let i = 0; i < TRIES; i++) {
        const u = i / TRIES;
        const budget = lerp(MAX_R, MIN_R, u * u);
        const x = box[0] + R('try', 'x', i) * (box[2] - box[0]);
        const y = box[1] + R('try', 'y', i) * (box[3] - box[1]);
        const grain = fbm(R, x / 420, y / 420, 3, 'grain');

        let r = Math.min(
          budget * lerp(0.22, 1, grain * grain),
          x - box[0], box[2] - x, y - box[1], box[3] - y,
        );

        const reach = Math.ceil((budget + MAX_R + gap) / CELL);
        const cx = Math.floor(x / CELL);
        const cy = Math.floor(y / CELL);
        for (let a = cx - reach; a <= cx + reach && r >= MIN_R; a++) {
          for (let b = cy - reach; b <= cy + reach; b++) {
            const cell = grid.get(keyOf(a, b));
            if (cell === undefined) continue;
            for (const f of cell) {
              const d = Math.hypot(x - f.x, y - f.y) - f.r - gap;
              if (d < r) r = d;
            }
          }
        }
        if (r < MIN_R) continue;
        const form = { x, y, r, i, grain };
        placed.push(form);
        add(form);
      }
      s.tried = TRIES;

      // A form is a ring whose radius is a field read around the circle, so the
      // same construction gives a disc, a lobed blob or a folded one depending
      // on one parameter -- and the field is addressed, so a form keeps its
      // shape when a form somewhere else appears or goes.
      const fold = s.params.lobes;
      s.forms = placed.map((f) => {
        // Spokes from the form's own size, so a small form is not carrying the
        // point budget of a large one. The ring is then smoothed once rather
        // than sampled finely -- a pass of corner cutting buys more smoothness
        // per point than doubling the spokes does.
        const spokes = Math.max(9, Math.min(48, Math.round(f.r * 0.42)));
        const twist = R('form', 'twist', f.i) * Math.PI * 2;
        const raw = ring(f.x, f.y, spokes, (a) => {
          const n = fbm(R, Math.cos(a) * 1.4 + f.i * 0.37, Math.sin(a) * 1.4 + f.i * 0.37, 3, 'lobe');
          return f.r * lerp(1, 0.44 + n * 1.15, fold);
        }, twist);

        // Ink follows the grain, nudged by the form's own draw. Pure chance per
        // form scatters the colours evenly and the sheet loses its regions; pure
        // field makes flat blocks of one colour. The nudge is what leaves a
        // region legible while still letting a stray land inside it.
        const bias = clamp01(f.grain * 0.72 + R('form', 'ink', f.i) * 0.46);

        // THREE TREATMENTS, NOT A GRADIENT. A press lays an ink down or it does
        // not; what it cannot do is a smooth ramp of coverage, and a set of
        // forms that each sit at their own percentage is the single clearest
        // sign of something rendered rather than printed. So: solid, tinted, or
        // outline only -- and the solids are rare, because the darkest value in
        // a picture is the one that decides where the eye goes.
        const big = clamp01(f.r / MAX_R);
        const d = R('form', 'tone', f.i);
        const tone = d < 0.06 + big * 0.26 ? 'solid' : d < 0.64 ? 'tint' : 'open';

        // THE DARKEST INK IS NOT ONE OF FOUR. A palette handed out evenly gives
        // every colour the same job, and then nothing in the picture is the
        // anchor -- which is how a sheet ends up pleasant and unreadable. The
        // dark goes to the solids, and the solids are mostly the large forms, so
        // the few darkest shapes are also the biggest and the eye has somewhere
        // to land. Art direction, stated: N2.
        const ink = tone === 'solid' && d < 0.16 ? INKS[0] : pick(INKS, bias);

        return {
          pts: chaikin(raw, 1, true),
          r: f.r,
          i: f.i,
          grain: f.grain,
          tone,
          ink,
          weight: lerp(0.9, 3.6, clamp01(R('form', 'weight', f.i) * 0.5 + big)),
        };
      });
      s.placed = s.forms.length;
    }],

    ['shell and clip', (s) => {
      const box = boxOf({ w: W, h: H }, M);
      const shells = Math.round(s.params.shells);

      for (const f of s.forms) {
        // The centre a shell shrinks towards is the AREA centroid, not the mean
        // of the points: a chaikin pass leaves points bunched on the tight
        // corners, and shrinking towards their average pulls every shell
        // sideways out of its own form.
        const c = centroid(f.pts);
        f.centre = c;

        // THE TAPERED OUTLINE IS A HIERARCHY DECISION, NOT A DEFAULT. A ribbon
        // doubles the points of the ring it wraps, and a taper a pen-width wide
        // is invisible on a form the size of a full stop. It is spent on the
        // forms large enough to show it and nowhere else -- which is the same
        // reason the small ones get fewer spokes.
        f.edge = null;
        if (f.r > 30) {
          // Resampled before anything per-point happens to it. The ring's spokes
          // are even in ANGLE, which on a folded form is nowhere near even along
          // the outline -- so a taper applied to the raw points thickens wherever
          // the form folds inward, for no reason the picture can explain.
          const even = resample(f.pts, Math.max(4, f.r * 0.14), true);
          const outline = ribbon(even, (k, n) => {
            const along = k / (n - 1);
            return f.weight * (0.3 + 0.7 * Math.sin(along * Math.PI));
          });
          f.edge = clipPolyline(outline, box, true);
        }

        // Shells are the reward for looking closely, so they go on the forms
        // there is room to look INTO. A shell inside a small form is three
        // pixels of noise.
        f.rings = [];
        if (f.r > 20) {
          for (let k = 1; k <= shells; k++) {
            const t = 1 - (k / (shells + 1)) * 0.82;
            const inner = f.pts.map((p) => [c[0] + (p[0] - c[0]) * t, c[1] + (p[1] - c[1]) * t]);
            // A shell that has collapsed onto its own centre is not a mark.
            if (lengthOf(inner, true) < 26) break;
            f.rings.push(...clipPolyline(inner, box, true));
          }
        }
        f.body = clipPolyline(f.pts, box, true);
      }

      // Published so the ratio can be read rather than assumed, the same way
      // contours publishes its segment and path counts.
      const all = s.forms.flatMap((f) => f.pts);
      s.bounds = all.length ? bbox(all) : null;
      s.marks = s.forms.reduce((n, f) => n + f.body.length + (f.edge ? f.edge.length : 0) + f.rings.length, 0);
    }],

    ['mark the quiet ones', (s) => {
      // A dot inside the smallest forms, placed at the centroid and kept only
      // when the centroid is actually INSIDE -- a folded ring's centroid can sit
      // outside its own outline, and a dot there reads as a mistake.
      s.dots = [];
      for (const f of s.forms) {
        if (f.r > 26) continue;
        if (!pointInPoly(f.centre, f.pts)) continue;
        s.dots.push({ at: f.centre, r: Math.max(1.1, f.r * 0.09), ink: f.ink });
      }
    }],
  ],

  draw(g, s) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    g.lineJoin = 'round';
    g.lineCap = 'round';

    // Every under-impression first, then every over-impression. A press prints
    // one plate across the WHOLE sheet before the next one goes on, so a form
    // late in the run cannot sit on top of a form early in it -- and printing
    // each form's two layers together, form by form, is exactly the thing that
    // would let it. This is the difference between two plates and a stack of
    // stickers, and it is one loop either way.
    for (const f of s.forms) {
      if (f.tone === 'open') continue;
      // Mixed towards the paper in LINEAR LIGHT, so the tint sits where the
      // light between ink and paper actually is, not where the numbers average.
      g.fillStyle = f.tone === 'solid' ? f.ink : mix(f.ink, PAPER, 0.3);
      g.save();
      g.translate(-SLIP * 0.7, SLIP * 0.5);
      for (const run of f.body) { poly(g, run, true); g.fill(); }
      g.restore();
    }

    for (const f of s.forms) {
      const line = f.tone === 'solid' ? mix(f.ink, PAPER, 0.62) : f.ink;

      // A large form gets its outline as a FILLED ribbon, so the weight can vary
      // along it; a small one gets a plain stroke, because a taper narrower than
      // a pen is a taper nobody sees. The two are the same mark at two scales.
      if (f.edge) {
        g.fillStyle = line;
        for (const run of f.edge) { poly(g, run, true); g.fill(); }
      } else {
        g.strokeStyle = line;
        g.lineWidth = f.weight * 0.85;
        for (const run of f.body) stroke(g, run, true);
      }

      g.strokeStyle = f.tone === 'solid' ? mix(f.ink, PAPER, 0.55) : mix(f.ink, PAPER, 0.35);
      g.lineWidth = 0.8;
      for (const run of f.rings) stroke(g, run, true);
    }

    for (const d of s.dots) {
      g.fillStyle = d.ink;
      g.beginPath();
      g.arc(d.at[0], d.at[1], d.r, 0, Math.PI * 2);
      g.fill();
    }
  },
};
