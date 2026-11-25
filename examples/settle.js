// settle -- a system of forces finds its own arrangement, and the arrangement is
// the picture.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other example
// draws a frame from a closed form: give it t and it evaluates. This one has a
// STATE THAT EVOLVES -- each frame depends on the frame before it -- and the
// determinism contract still has to hold under a scrub. The resolution is that
// the whole trajectory is solved once, in the build, and `draw` is a pure lookup
// into it. A piece whose motion is integrated inside `draw` cannot be scrubbed,
// and no check in this repo would notice: it would still be a pure function of
// (state, t) on every path anyone tests.
//
// The structure is FIXED DATA and the seed may not touch it. The seed decides
// where the nodes start, how heavy they are, and what colour the sheet runs in.
// It does not decide what is connected to what. Solve at two seeds and the edge
// table is identical while nothing else is -- that check can fail, which is the
// point, and it is the same argument `readout` makes about a dataset made here
// about a topology.
//
// The table below is hand-authored and is the whole of the piece's subject: three
// clusters of different density, three bridges between them, and one chain with a
// fork hanging off the middle cluster. 46 nodes, 68 edges, degrees 1 to 6.
//
// ONCE THE COLLAPSE HAS THINNED IT IS PLUCKED. A graph that has found its
// arrangement is a still picture, and a film that ends on seconds of one
// picture is a held frame. So the medium thickens while the scattered start
// collapses into clusters, and from about three seconds a light node is plucked
// every 0.4 s or so: it flies out on its edges, they snap taut, and the
// disturbance rings through the graph and dies before the next. The
// arrangement is the one the forces found; the plucks only show that it holds.
// What they cannot promise is a graph at rest: at some seeds a node is still
// finding its place at any time in the film, creeping around its neighbours
// and then sliding over, and a pluck can set one going. That is the subject,
// and it is drawn and heard like everything else.
//
// IT ALSO SOUNDS, AND EVERY SOUND IS AN EVENT THE PICTURE SHOWS. An edge that
// comes taut on a frame snaps on that frame, two discs that meet knock, and a
// pluck rings on the node's own string. Each pitch is a whole harmonic of one
// root -- a node's from its degree, a snap's the sum of its ends', so no seed
// can move the chord off the harmonics -- each is as hard as the motion that
// made it, a snap or a knock on the logarithm of its speed over its own
// kind's measured range (see FAST) -- panned where it stands and as far off
// as it stands from the middle of the field. So the opening rattle runs from
// soft to full, and most knocks after the first pluck sound at their own
// level, though about one in nine still sits at the softest. The opening is a
// rattle of snaps that thins as the graph collapses to a quiet before the
// first pluck: measured on seeds 1 to 300 at the corners, midpoints and
// default of the parameters, the second before it held nothing in three runs
// of four and six events at the most, against 45 or more in the first second;
// after it, each pluck and the snaps it sets off.

'use strict';

const { rng } = require('../core/rand.js');
const { sumInto, voice, room } = require('../core/sound.js');

// ---------------------------------------------------------------------------
// The data. Nothing seeded may reach this.
// ---------------------------------------------------------------------------

const EDGES = [
  // cluster A -- a dense core around node 0
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 11],
  [1, 2], [2, 3], [3, 4], [4, 5], [5, 1],
  [1, 6], [6, 7], [7, 2], [3, 8], [8, 9], [9, 4], [5, 10], [10, 11],
  [6, 12], [12, 13], [13, 7],
  // cluster B -- a ring of rings, evenly wound
  [14, 15], [14, 16], [14, 17], [14, 18],
  [15, 16], [16, 17], [17, 18], [18, 15],
  [15, 19], [19, 20], [20, 16], [17, 21], [21, 22], [22, 18],
  [19, 23], [23, 24], [24, 20], [21, 25], [25, 26], [26, 22],
  [23, 27], [27, 25],
  // cluster C -- a sparse ring with three chords
  [28, 29], [29, 30], [30, 31], [31, 32], [32, 33], [33, 34], [34, 35], [35, 36], [36, 37], [37, 28],
  [28, 32], [30, 35], [31, 36],
  // the three bridges. These are the edges that stay under load once the
  // clusters have formed, and the drawing says so without being told which
  // ones they are.
  [11, 14], [22, 28], [9, 37],
  // one chain with a fork, so the set of degrees is not all the same number
  [24, 38], [38, 39], [39, 40], [40, 41], [41, 42], [42, 43], [40, 44], [44, 45],
];

// ---------------------------------------------------------------------------
// The design box and the plate
// ---------------------------------------------------------------------------

// The plate is nearly square because THE GRAPH IS. A force layout of this table
// settles into a round-ish mass, and a landscape field only gets filled by an
// aspect-shaped containment -- which is the frame doing the composition instead
// of the mechanism. The ellipse below is a safety, not a frame: the charge
// range stops where the graph settles short of it. Measured on seeds 1 to 300
// at the corners, midpoints and default of the parameters, 3000 solves, on
// the frame before the first pluck, the graph reaches 0.55 to 0.72 of the
// ellipse at a charge of 200 and 0.74 to 1.0 at 700, and touches it in two
// runs of 900 at 700, by one node; the range once ran to 5200, where half the
// nodes rested against the wall and the composition was its shape.
// What reaches it from the first pluck on is a plucked node or, now and then,
// a chain node a plucked neighbour drags out.
const W = 680;
const H = 730;
const M = 56;
const TRACE_H = 64;          // the energy trace at the foot of the plate
const PANEL_B = H - M - TRACE_H - 26;   // bottom of the field the graph lives in

const CX = W / 2;
const CY = (M + PANEL_B) / 2;
const EX = 268;
const EY = 248;

const PAPER = '#f8f6f1';
const PANEL = '#f1eee6';
const MUTE = '#cac4b6';
const INK = '#20201e';
const ACCENTS = ['#b4462a', '#2d6382', '#3d6b46', '#7a4a86'];

// The timeline. The build solves all of it before any frame is drawn, so it
// needs the frame count here: it stores one snapshot per drawn frame, the first
// the scattered start and the last three frames after the last pluck, still
// moving from it. Frame k shows snapshot k: `draw` reads `clock.frame` and
// `sound` its own frame index, both through `at`.
const DUR = 6;
const HZ = 24;
const FRAMES = Math.round(DUR * HZ);
const LAST = FRAMES - 1;

// ---- the integrator -------------------------------------------------------
const SUB = 2;               // substeps per drawn frame
const REST = 52;             // edge rest length
const SOFT = 220;            // softening, so a near-collision is not a cannon
const GRAV = 0.0035;         // weak pull to the middle of the field. Weak on
                             // purpose: a strong one sets the size of the whole
                             // layout, and then the picture is a property of the
                             // frame rather than of the graph.
const LOADED = 3;            // how many edges are drawn as the ones under load
const WALL = 0.9;            // how hard the containment ellipse pushes back
// WHAT SLOWS THE SYSTEM IS THE MEDIUM, NOT A SCHEDULE. An earlier version
// annealed it with a falling ceiling on displacement, the way
// Fruchterman-Reingold does. Measured, the ceiling turned out to be binding on
// every frame of the timeline for seven of nine seeds -- the node with the
// largest step moved exactly 2x the ceiling (two substeps, each clamped) from
// frame 10 to the end. The motion on screen was the cooling curve, and the
// physics was only choosing directions. So damping rises instead: the fluid the
// graph is suspended in stays thin while the scattered start collapses, until
// THIN, and thickens to HOLD by THICK. The ceiling is left in as a safety
// against the first few steps, where a random start puts 500-unit springs in
// the sheet, and sits above the fastest pluck, so no pluck is drawn slower
// than it was struck: KICK on the lightest node is 19 a substep before the
// damping, and measured on seeds 1 to 300 at the corners, midpoints and
// default of the parameters, 3000 solves, no node moved faster than 16.1 a
// substep from THICK on, plucked nodes on their kick substep included, and
// the ceiling clamped none. It
// clamps the velocity, not only the step: a node whose step is cut but whose
// velocity is kept rides the ceiling for a second after its spring has gone
// slack, and overshoots its cluster. HOLD is a balance: at 0.9 a
// quarter of the seeds went on boiling for the whole film, twenty or more
// snaps a second with no pluck to blame, and at 0.8 a plucked node was back
// at rest in half a second, so the gaps between plucks held still. The
// collapse's soft modes, a sparse ring swinging on its bridge or a node
// creeping around its neighbours, relax at the medium's mobility too, and at
// some seeds one is still going at any time in the film.
const DAMP0 = 0.93;          // viscosity while the graph collapses, until THIN
const HOLD = 0.83;           // viscosity from THICK on
const THIN = 1.0;            // seconds; the medium thickens from here
const THICK = 2.2;           // seconds; at HOLD from here
const CEILING = 26;          // the most a node moves in one substep
// The plucks: PLUCKS of them, the first once the collapse's rattle has thinned
// at every seed and the last three frames before the end, so the last frame
// still moves from it. Each goes to a light node, never the one plucked
// before, pushes it straight out from the middle of the graph, or along the
// rim of the field when it rests against the wall, and is a seeded share
// between 0.6 and all of KICK, an impulse in mass times design units per
// substep. One every 0.4 s or so, each ringing for most of that, is what
// keeps the graph moving on every frame from the first pluck; at six plucks
// there were frames between them on which nothing moved. Every pluck but the
// last lands a little before or after its even share of the time.
const PLUCKS = 8;
const PLUCK_FROM = 3.0;      // seconds
const PLUCK_TO = 5.85;
const JITTER = 0.16;         // of the plucks' even spacing, either way
const RIM = 0.9;             // of the field's half-width: a node past this is on the wall
const KICK = 22;
const FLY = 30;              // design units a frame: the travel of the hardest
                             // pluck on its frame. The sound of a pluck is as
                             // hard as this travel, not as the kick: a heavier
                             // node, or one sent along the wall, flies slower
                             // from the same kick, and in 11541 of 84000 pairs
                             // of plucks over seeds 1 to 300 at the corners,
                             // midpoints and default of the parameters the
                             // harder kick was the slower flight. Measured
                             // there, a pluck travels 10.6 to 29.2 on its frame.
const TAIL = 7;              // frames of travel a node leaves behind it
const TAIL_MIN = 1.6;        // below this much travel there is no trail at all

// ---- the soundtrack -------------------------------------------------------
const ROOT = 98;             // G2, in Hz. A node sounds the harmonic its degree
                             // counts down from the busiest node, so the hubs
                             // sound the root and its octave, the leaves the
                             // sixth harmonic. A snap sounds the sum of its
                             // ends' harmonics, so every pitch in the piece is
                             // a whole harmonic of the root and no seed can
                             // move it.
const SNAP = 4;              // design units of stretch per frame: an edge coming
                             // taut slower than this is not heard. It is what
                             // keeps the graph quiet between plucks: the last
                             // of the collapse creeps at one to three units a
                             // frame, and at 2.5 that creep crossed the bar on
                             // and off and was heard as a rattle.
// How hard a snap or a knock sounds follows the logarithm of its speed over
// its own kind's range, from the softest level at the bottom to full at the
// top, so a tenth of the speed is still a soft sound, not silence. Each range
// is the one measured on seeds 1 to 300 at the corners, midpoints and default
// of the parameters, 3000 solves, from about its 1st to its 99th percentile:
// snaps stretch from SNAP to 103.9 a frame, 82.9 at the 99th percentile, the
// opening rattle's all through it and none from the first pluck faster than
// 26.3; knocks close at 0.004 to 103.9 a frame, 0.17 and 99.7 at the 1st and
// 99th percentiles, and half the 6071 from the first pluck slower than 1.65.
// So the rattle keeps its range, and the plucks' snaps and knocks sound
// softer than it, each as hard as its own motion: there, 2065 of the 196980
// snaps and 861 of the 88940 knocks before the first pluck sound at full
// level, and 664 of the 6071 knocks from it at the softest. Once, one range
// served both kinds: 4312 of those 6071 knocks were slower than SNAP and
// sounded at one floor level, and 37209 of the snaps in the rattle and 26112
// of its knocks at full level.
const FAST = 84;             // design units of stretch per frame at which a
                             // snap sounds at full level
const KNOCK_SOFT = 0.17;     // closing speed a frame of the softest knock
const KNOCK_HARD = 100;      // and of a knock at full level
const QUIET = 4;             // frames before one edge can snap again
const BUSY = 2;              // the most snaps heard on one frame, the fastest
                             // first: the opening has dozens, and forty at once
                             // is a noise band, not events
const WIDTH = 0.85;          // how far to either side a sound may pan
const FAR = 0.7;             // the distance of a sound at the rim of the field;
                             // one at its middle is near

// ---------------------------------------------------------------------------

module.exports = {
  name: 'settle',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: { duration: DUR, hz: HZ },
  seed: 8,
  params: {
    charge: { min: 200, max: 700, value: 500,
      meaning: 'how hard the nodes push each other apart, and so how open the graph settles' },
    tension: { min: 0.03, max: 0.30, value: 0.11,
      meaning: 'how hard an edge pulls its two nodes together, and so how tight the clusters are' },
  },

  // `edges` is NOT put in the state. A state that hands back the module-level
  // table lets a build stage write per-solve presentation onto the shared pair
  // objects, and the next solve at another seed reads the previous one's values.
  // Nothing in the contract or the suite can see that; it is a fresh-object rule
  // the `state()` signature implies and does not enforce.
  // `ellipse` is the containment the solver pushes back from, published so a
  // test can measure the graph against the wall the piece has, not a copy.
  state: () => ({ nodes: [], eweight: [], plucks: [], traj: null, energy: null, events: [], peak: 1, accent: ACCENTS[0],
    ellipse: { cx: CX, cy: CY, rx: EX, ry: EY } }),

  build: [
    ['read the graph', (s) => {
      // NOTHING SEEDED HAPPENS IN THIS STAGE. The separation is the example.
      let n = 0;
      for (const [a, b] of EDGES) n = Math.max(n, a + 1, b + 1);
      s.nodes = Array.from({ length: n }, (_, i) => ({ i, deg: 0 }));
      for (const [a, b] of EDGES) { s.nodes[a].deg++; s.nodes[b].deg++; }
    }],

    ['choose the presentation', (s) => {
      const R = rng(s.seed);
      s.accent = ACCENTS[Math.floor(R('sheet', 'accent') * ACCENTS.length)];
      for (const nd of s.nodes) {
        // Compositional: where this node happens to start. Addressed by index,
        // so adding a node to the table cannot move where the others begin.
        const a = R('start', 'angle', nd.i) * Math.PI * 2;
        const q = Math.sqrt(R('start', 'radius', nd.i));
        nd.x0 = CX + Math.cos(a) * q * EX * 0.94;
        nd.y0 = CY + Math.sin(a) * q * EY * 0.94;
        // Morphological: how much of the system's momentum this node carries.
        nd.mass = 1 + 0.16 * nd.deg + R('mass', 'grain', nd.i) * 0.22;
        // Material: the disc is drawn, not stamped, so no two are the same size.
        nd.grain = (R('node', 'grain', nd.i) - 0.5) * 1.1;
      }
      for (let e = 0; e < EDGES.length; e++) {
        // Material again, and separately addressed: a pen that does not lay the
        // same weight twice. One field serving every irregularity is the tell.
        s.eweight[e] = (R('edge', 'grain', e) - 0.5) * 0.28;
      }
      // Compositional: which light node each pluck goes to, a little before or
      // after its even share of the time, and how hard.
      const light = s.nodes.filter((nd) => nd.deg <= 2).map((nd) => nd.i);
      let last = -1;
      for (let k = 0; k < PLUCKS; k++) {
        const pick = light.filter((i) => i !== last);
        const node = pick[Math.floor(R('pluck', 'node', k) * pick.length)];
        const sway = k < PLUCKS - 1 ? JITTER * (R('pluck', 'time', k) - 0.5) : 0;
        const sec = PLUCK_FROM + ((PLUCK_TO - PLUCK_FROM) * (k + sway)) / (PLUCKS - 1);
        s.plucks.push({ node, frame: Math.round(sec * HZ), force: KICK * (0.6 + 0.4 * R('pluck', 'force', k)) });
        last = node;
      }
    }],

    ['settle the system', (s) => {
      // The whole timeline, solved once. `draw` may not integrate: a scrub to
      // t=0.3 must give the frame that playing to t=0.3 gives, and an integrator
      // in `draw` gives whatever the last call left behind.
      const N = s.nodes.length;
      const charge = s.params.charge;
      const tension = s.params.tension;

      const px = new Float64Array(N);
      const py = new Float64Array(N);
      const vx = new Float64Array(N);
      const vy = new Float64Array(N);
      const fx = new Float64Array(N);
      const fy = new Float64Array(N);
      const mass = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        px[i] = s.nodes[i].x0;
        py[i] = s.nodes[i].y0;
        mass[i] = s.nodes[i].mass;
      }

      const traj = new Float64Array(FRAMES * N * 2);
      const energy = new Float64Array(FRAMES);
      for (let i = 0; i < N; i++) { traj[i * 2] = px[i]; traj[i * 2 + 1] = py[i]; }

      // Frame k shows the system after k * SUB substeps, the last frame
      // included, so every frame spans one frame of time, and the loop ends
      // with the last snapshot stored. A pluck lands on the first substep of
      // the interval that ends on its frame, so its frame is the first to
      // show it.
      const kicks = new Map(s.plucks.map((k) => [(k.frame - 1) * SUB, k]));
      let frame = 1, acc = 0, taken = 0;
      for (let step = 0; frame <= LAST; step++) {
        // Neither the ceiling nor the viscosity touches the forces, so the
        // equilibrium the system is heading for never moves while it settles.
        // A piece that cools by weakening its own forces is chasing a target it
        // is also dragging.
        const sec = step / (SUB * HZ);
        const damp = Math.max(HOLD, DAMP0 - ((DAMP0 - HOLD) * Math.max(0, sec - THIN)) / (THICK - THIN));
        const kick = kicks.get(step);
        if (kick) {
          // Straight out from the middle of the graph, so the node's own edges
          // are what stop it and bring it back. A node already on the rim of
          // the field goes along the rim instead, away from its neighbours,
          // because out there the wall would stop it dead on the next step.
          let mx = 0, my = 0;
          for (let i = 0; i < N; i++) { mx += px[i] / N; my += py[i] / N; }
          const i = kick.node;
          const d = Math.hypot(px[i] - mx, py[i] - my) || 1;
          let ux = (px[i] - mx) / d;
          let uy = (py[i] - my) / d;
          if (Math.hypot((px[i] - CX) / EX, (py[i] - CY) / EY) >= RIM) {
            let nx = 0, ny = 0;
            for (const [a, b] of EDGES) {
              if (a === i) { nx += px[b] - px[i]; ny += py[b] - py[i]; }
              if (b === i) { nx += px[a] - px[i]; ny += py[a] - py[i]; }
            }
            const side = nx * -uy + ny * ux > 0 ? -1 : 1;
            [ux, uy] = [-uy * side, ux * side];
          }
          vx[i] += ux * (kick.force / mass[i]);
          vy[i] += uy * (kick.force / mass[i]);
        }
        fx.fill(0); fy.fill(0);

        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            let dx = px[i] - px[j];
            let dy = py[i] - py[j];
            let d2 = dx * dx + dy * dy;
            if (d2 < 1e-9) { dx = 1e-4; dy = 0; d2 = 1e-8; }
            const d = Math.sqrt(d2);
            const f = charge / (d2 + SOFT) / d;
            fx[i] += dx * f; fy[i] += dy * f;
            fx[j] -= dx * f; fy[j] -= dy * f;
          }
        }

        for (let e = 0; e < EDGES.length; e++) {
          const a = EDGES[e][0];
          const b = EDGES[e][1];
          const dx = px[b] - px[a];
          const dy = py[b] - py[a];
          const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
          const f = tension * (d - REST) / d;
          fx[a] += dx * f; fy[a] += dy * f;
          fx[b] -= dx * f; fy[b] -= dy * f;
        }

        let sum = 0;
        for (let i = 0; i < N; i++) {
          const rx = px[i] - CX;
          const ry = py[i] - CY;
          fx[i] -= rx * GRAV; fy[i] -= ry * GRAV;
          const q = Math.sqrt((rx / EX) * (rx / EX) + (ry / EY) * (ry / EY));
          if (q > 1) { const k = WALL * (q - 1) / q; fx[i] -= rx * k; fy[i] -= ry * k; }
          vx[i] = (vx[i] + fx[i] / mass[i]) * damp;
          vy[i] = (vy[i] + fy[i] / mass[i]) * damp;
          const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
          if (sp > CEILING) { const k = CEILING / sp; vx[i] *= k; vy[i] *= k; }
          px[i] += vx[i]; py[i] += vy[i];
          sum += Math.min(sp, CEILING);
        }
        acc += sum / N;
        taken++;

        if (step + 1 === frame * SUB) {
          const o = frame * N * 2;
          for (let i = 0; i < N; i++) { traj[o + i * 2] = px[i]; traj[o + i * 2 + 1] = py[i]; }
          energy[frame] = acc / taken;
          acc = 0; taken = 0; frame++;
        }
      }

      let peak = 0;
      for (let f = 0; f < FRAMES; f++) if (energy[f] > peak) peak = energy[f];
      s.traj = traj;
      s.energy = energy;
      s.peak = peak || 1;
    }],

    ['hear the system', (s) => {
      // Every sound is read off the drawn snapshots, on the frame that first
      // shows its cause: a taut edge that starts to stretch at SNAP or faster
      // snaps, two discs apart on one frame and touching on the next knock,
      // and a pluck rings on its own frame.
      const N = s.nodes.length;
      const len = (f, e) => {
        const [ax, ay] = at(s, f, EDGES[e][0]);
        const [bx, by] = at(s, f, EDGES[e][1]);
        return Math.hypot(bx - ax, by - ay);
      };
      const gap = (f, i, j) => {
        const [ax, ay] = at(s, f, i);
        const [bx, by] = at(s, f, j);
        return Math.hypot(bx - ax, by - ay) - radius(s.nodes[i]) - radius(s.nodes[j]);
      };
      // How hard each is heard, from 0.2 to 1: see FAST.
      const hard = (speed, soft, full) => 0.2 + 0.8 * Math.max(0, Math.min(1, Math.log(speed / soft) / Math.log(full / soft)));
      const events = [];
      const heard = new Array(EDGES.length).fill(-Infinity);
      for (let f = 1; f < FRAMES; f++) {
        const snaps = [];
        for (let e = 0; e < EDGES.length; e++) {
          const pull = len(f, e) - len(f - 1, e);
          const before = f > 1 ? len(f - 1, e) - len(f - 2, e) : 0;
          if (len(f, e) > REST && pull >= SNAP && before < SNAP && f - heard[e] > QUIET) snaps.push({ e, speed: pull });
        }
        snaps.sort((x, y) => y.speed - x.speed || x.e - y.e);
        for (const { e, speed } of snaps.slice(0, BUSY)) {
          heard[e] = f;
          const [ax, ay] = at(s, f, EDGES[e][0]);
          const [bx, by] = at(s, f, EDGES[e][1]);
          events.push({ kind: 'snap', frame: f, nodes: EDGES[e].slice(), speed, velocity: hard(speed, SNAP, FAST), x: (ax + bx) / 2, y: (ay + by) / 2 });
        }
        // The hardest meeting on the frame, and only one: the scattered start
        // passes a dozen discs through each other at once.
        let knock = null;
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const speed = gap(f - 1, i, j) - gap(f, i, j);
            if (gap(f - 1, i, j) > 0 && gap(f, i, j) <= 0 && !(knock && knock.speed >= speed)) knock = { i, j, speed };
          }
        }
        if (knock) {
          const [ax, ay] = at(s, f, knock.i);
          const [bx, by] = at(s, f, knock.j);
          events.push({ kind: 'knock', frame: f, nodes: [knock.i, knock.j], speed: knock.speed,
            velocity: hard(knock.speed, KNOCK_SOFT, KNOCK_HARD), x: (ax + bx) / 2, y: (ay + by) / 2 });
        }
      }
      for (const k of s.plucks) {
        const [x, y] = at(s, k.frame, k.node);
        const [hx, hy] = at(s, k.frame - 1, k.node);
        const speed = Math.hypot(x - hx, y - hy);
        events.push({ kind: 'pluck', frame: k.frame, node: k.node, speed, velocity: Math.min(1, speed / FLY), x, y });
      }
      s.events = events.sort((a, b) => a.frame - b.frame);
    }],
  ],

  draw(g, s, _t, clock) {
    const N = s.nodes.length;
    const f = clock.frame;

    // --- the plate ------------------------------------------------------
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    g.fillStyle = PANEL;
    g.fillRect(M, M, W - 2 * M, PANEL_B - M);

    g.strokeStyle = MUTE;
    g.lineWidth = 0.7;
    g.beginPath();
    g.rect(M, M, W - 2 * M, PANEL_B - M);
    g.stroke();

    // --- the edges, weighted by what they are carrying -------------------
    // An edge longer than its rest length is under tension and is drawn heavy
    // and dark; a compressed one is drawn pale and thin. Once the clusters
    // have formed the three bridges are the edges still loaded, so the
    // picture reports the structure it found rather than merely displaying it.
    const strain = new Array(EDGES.length);
    for (let e = 0; e < EDGES.length; e++) {
      const [ax, ay] = at(s, f, EDGES[e][0]);
      const [bx, by] = at(s, f, EDGES[e][1]);
      strain[e] = (Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) - REST) / REST;
    }
    // Exactly the LOADED most-stretched edges take the accent, ranked rather
    // than thresholded. A threshold gives 2 accents on one seed and 13 on the
    // next, and the number of emphatic marks in a composition is not something
    // to leave to a re-roll.
    const rank = strain.map((v, e) => e).sort((a, b) => strain[b] - strain[a]);
    const hot = new Set(rank.slice(0, LOADED));

    g.lineCap = 'butt';
    for (let e = 0; e < EDGES.length; e++) {
      const [ax, ay] = at(s, f, EDGES[e][0]);
      const [bx, by] = at(s, f, EDGES[e][1]);
      // The multiplier is 2.2 and not 1.1 because at 1.1 every edge in the sheet
      // landed between 0.3 and 0.8 of the ramp and the whole drawing came out
      // one weight -- a readout with no range is not a readout.
      const u = Math.max(0, Math.min(1, 0.5 + strain[e] * 2.2));
      g.strokeStyle = hot.has(e) ? s.accent : mix(MUTE, INK, u);
      g.lineWidth = Math.max(0.3, 0.35 + 2.3 * u + s.eweight[e]);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
    }

    // --- the travel behind each node -------------------------------------
    // A trail of LENGTH, never of opacity. A fading line is a finished line
    // being revealed; a shortening one is a pen slowing down, and a node that
    // has stopped has no trail rather than a transparent one.
    const trail = mix(PANEL, s.accent, 0.5);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = trail;
    g.lineWidth = 1.5;
    const back = Math.max(0, f - TAIL);
    for (let i = 0; i < N; i++) {
      const [hx, hy] = at(s, back, i);
      const [cx, cy] = at(s, f, i);
      if (Math.abs(cx - hx) + Math.abs(cy - hy) < TAIL_MIN) continue;
      g.beginPath();
      g.moveTo(hx, hy);
      for (let k = back + 1; k <= f; k++) { const [x, y] = at(s, k, i); g.lineTo(x, y); }
      g.stroke();
    }

    // --- the nodes --------------------------------------------------------
    // Size is degree, so the eye is sent to the parts of the graph that are
    // doing the most work rather than to every node equally.
    for (let i = 0; i < N; i++) {
      const nd = s.nodes[i];
      const [x, y] = at(s, f, i);
      // Size AND value both come from degree, so contrast falls away from the
      // parts of the graph doing the most work instead of every node receiving
      // the same algorithmic attention.
      const r = radius(nd);
      g.fillStyle = mix(MUTE, INK, 0.34 + 0.13 * nd.deg);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      if (nd.deg >= 5) {
        g.strokeStyle = s.accent;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x, y, r + 4.2, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // --- the same system read a second way --------------------------------
    // Mean displacement per frame, drawn up to where the playhead has got to.
    // It is what makes the arrival legible: the curve reaching the floor is the
    // graph finding its shape, and a reader can point at it. A pluck moves one
    // node, a bump under a pixel high on that scale, so each is a tick on the
    // floor instead, as tall as it was hard.
    const base = H - M;
    const span = W - 2 * M;
    g.strokeStyle = MUTE;
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(M, base);
    g.lineTo(W - M, base);
    g.stroke();

    if (f >= 1) {
      g.strokeStyle = INK;
      g.lineWidth = 1.4;
      g.lineJoin = 'round';
      g.beginPath();
      for (let k = 0; k <= f; k++) {
        const x = M + (k / LAST) * span;
        const y = base - (s.energy[k] / s.peak) * TRACE_H;
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      for (const k of s.plucks) {
        if (k.frame > f) continue;
        const x = M + (k.frame / LAST) * span;
        g.beginPath();
        g.moveTo(x, base);
        g.lineTo(x, base - 0.4 * TRACE_H * (k.force / KICK));
        g.stroke();
      }
    }

    // The playhead as a POSITION, not a fade. It is the only mark in the piece
    // whose job is to say where the piece has got to.
    const px = M + (f / LAST) * span;
    g.strokeStyle = s.accent;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(px, base + 8);
    g.lineTo(px, base - TRACE_H - 8);
    g.stroke();
  },

  // Heard as events, each started on the frame that shows its cause, all through
  // one room. Partials only: a snap is a wire pulled taut, a knock two discs of
  // wood, a pluck a string, and none of them is a band of noise.
  sound(ctx, s, timeline) {
    const R = rng(s.seed);
    const top = Math.max(...s.nodes.map((nd) => nd.deg));
    const harmonic = (i) => top + 1 - s.nodes[i].deg;

    const dry = ctx.createGain();
    const hall = room(ctx, R, 'room', { size: 1.6, bright: 6000, dark: 800 });
    const out = ctx.createGain();
    // The last pluck still rings on the last frame; it fades with the film,
    // over the frames after it, not on a cut.
    out.gain.value = 0.7;
    out.gain.setValueAtTime(0.7, Math.max(0, timeline.duration - 0.15));
    out.gain.linearRampToValueAtTime(0, timeline.duration);
    sumInto(ctx, [dry, hall], out);
    out.connect(ctx.destination);

    const voices = [];
    const sends = [];
    s.events.forEach((ev, n) => {
      let spec;
      if (ev.kind === 'snap') {
        // An edge sounds ROOT times the sum of its two ends' harmonics -- a
        // whole harmonic again, so the hubs' edges are low and the chain's
        // high -- and it rises into its note as it comes taut.
        const [a, b] = ev.nodes;
        spec = { pitch: ROOT * (harmonic(a) + harmonic(b)), partials: [[1, 1], [2.76, 0.3], [5.4, 0.08]],
          decay: 0.35, damp: 0.9, level: 0.05, bend: [[0, -40], [0.05, 0]] };
      } else if (ev.kind === 'knock') {
        // Two discs knock at the lower of their two harmonics: the busier
        // disc's, whatever their masses.
        spec = { pitch: ROOT * Math.min(harmonic(ev.nodes[0]), harmonic(ev.nodes[1])),
          partials: [[1, 1], [2.3, 0.3], [4.1, 0.08]], decay: 0.16, damp: 1, level: 0.06 };
      } else {
        // A plucked string starts sharp and falls into its note as it rings.
        spec = { pitch: ROOT * harmonic(ev.node), partials: [[1, 1], [2, 0.5], [3, 0.28], [4, 0.14], [5, 0.06]],
          detune: 3, decay: 1.8, damp: 0.7, level: 0.2, bend: [[0, 30], [0.15, 0]] };
      }
      // As hard as the motion that made it, as the build heard it.
      spec.velocity = ev.velocity;
      // Where it stands: to that side of the room, and as far off as it is
      // from the middle of the field.
      const q = Math.hypot((ev.x - CX) / EX, (ev.y - CY) / EY);
      const pan = WIDTH * Math.max(-1, Math.min(1, (ev.x - CX) / EX));
      const distance = FAR * Math.min(1, q);
      const v = voice(ctx, R, `${ev.kind} ${n}`, ev.frame / timeline.hz, { ...spec, pan, distance, vary: 0.5, attack: 0.003 });
      const send = ctx.createGain();
      send.gain.value = 0.15 + 0.6 * distance;
      v.connect(send);
      voices.push(v);
      sends.push(send);
    });
    // Two at a time, so every render adds the voices up in the same order.
    sumInto(ctx, voices, dry);
    sumInto(ctx, sends, hall);
  },
};

/** Where node i stands on drawn frame `frame`. The build stores one snapshot
 *  per drawn frame, so frame k shows snapshot k. `draw` and the events the
 *  soundtrack plays both read through here, so the picture and the sound cannot
 *  sample the trajectory differently. */
function at(s, frame, i) {
  const o = (frame * s.nodes.length + i) * 2;
  return [s.traj[o], s.traj[o + 1]];
}

/** A node's disc radius: size is degree, and the grain is the pen's. */
function radius(nd) {
  return 2.0 + 1.35 * nd.deg + nd.grain;
}

/** Blend two hex colours in display space, with the position clamped to [0, 1]. */
function mix(a, b, u) {
  const A = parseInt(a.slice(1), 16);
  const B = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, u));
  let out = '#';
  for (let sh = 16; sh >= 0; sh -= 8) {
    const c = Math.round(((A >> sh) & 255) + ((((B >> sh) & 255) - ((A >> sh) & 255)) * k));
    out += c.toString(16).padStart(2, '0');
  }
  return out;
}
