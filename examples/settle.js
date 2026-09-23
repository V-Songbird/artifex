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
// IT ALSO SOUNDS, AND NOTHING IN IT IS A NOTE. `readout` starts a sound on the
// frame that shows its cause; this piece follows a state that is there on every
// frame. Each node is a voice on the harmonic its degree gives -- the table
// again, so no seed can move the chord -- detuned by how far the node still sits
// above or below its resting place, panned where it stands with the bass held in
// the middle, and as loud and as bright as the energy trace says the system is
// moving. The cluster comes into tune as the graph comes to rest, and falls
// silent with it.

'use strict';

const { rng } = require('../core/rand.js');

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
  // the three bridges. These are the edges that stay under load at rest, and
  // the drawing says so without being told which ones they are.
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
// of the mechanism. The ellipse below is a safety that should never bind.
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
// the scattered start and the last the completed rest. Frame k shows snapshot k:
// `draw` reads `clock.frame` and `sound` its own frame index, both through `at`.
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
// WHAT BRINGS THE SYSTEM TO REST IS THE MEDIUM, NOT A SCHEDULE. An earlier
// version annealed it with a falling ceiling on displacement, the way
// Fruchterman-Reingold does. Measured, the ceiling turned out to be binding on
// every frame of the timeline for seven of nine seeds -- the node with the
// largest step moved exactly 2x the ceiling (two substeps, each clamped) from
// frame 10 to frame 144. The motion on screen was the cooling curve, and the
// physics was only choosing directions. So damping rises instead: the fluid the
// graph is suspended in thickens, and the ceiling is left in as a safety against
// the first few steps, where a random start puts 500-unit springs in the sheet.
const DAMP0 = 0.93;          // viscosity at t=0, falling as (1 - t^2) to zero
const TEMP0 = 26;            // displacement safety at the first step, falling
                             // linearly to exactly zero at the last, so the
                             // final frame is still by construction
const TAIL = 7;              // frames of travel a node leaves behind it
const TAIL_MIN = 1.6;        // below this much travel there is no trail at all

// ---- the soundtrack -------------------------------------------------------
const ROOT = 98;             // G2, in Hz. A node sounds the harmonic its degree
                             // counts down from the busiest node, so at rest the
                             // hubs hold the root and its octave, the leaves the
                             // sixth harmonic, and the spectrum of the chord is
                             // the degree table of the graph.
const CENTS = 90;            // detune per unit of asinh(offset / NEAR)
const NEAR = 4;              // design units. Nearer its rest than this a voice's
                             // detune falls linearly to nothing; farther, it
                             // grows as a logarithm, so a node 200 units out is
                             // about a major third away, where a straight line
                             // with the same slope at rest would put it almost
                             // four octaves off.
const STILL = 0.0003;        // the slowest mean travel per substep that is heard
                             // at all. The level is the logarithm of the trace
                             // above it: the trace falls through five orders of
                             // magnitude, and a level read linearly would be
                             // silent after the first second.
const DARK = 500;            // lowpass cutoff in Hz at rest,
const BRIGHT = 8000;         // and in full motion
const WIDTH = 0.85;          // how far to either side the highest voices may pan.
                             // A voice's reach grows with its pitch in octaves
                             // above the root's octave, so the root and octave,
                             // at 98 and 196 Hz, stay in the middle, as mixes
                             // keep the bass: a panned voice loses up to 3 dB
                             // when a phone or a mono speaker folds the mix to
                             // one channel, and a centred one keeps its level.
const LEVEL = 0.8;           // the voices' gains sum to this, so even every voice
                             // peaking at once, through the filter's 2 dB
                             // resonance, stays within full scale

// ---------------------------------------------------------------------------

module.exports = {
  name: 'settle',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: { duration: DUR, hz: HZ },
  seed: 8,
  params: {
    charge: { min: 700, max: 5200, value: 2600,
      meaning: 'how hard the nodes push each other apart, and so how open the graph settles' },
    tension: { min: 0.03, max: 0.30, value: 0.11,
      meaning: 'how hard an edge pulls its two nodes together, and so how tight the clusters are' },
  },

  // `edges` is NOT put in the state. A state that hands back the module-level
  // table lets a build stage write per-solve presentation onto the shared pair
  // objects, and the next solve at another seed reads the previous one's values.
  // Nothing in the contract or the suite can see that; it is a fresh-object rule
  // the `state()` signature implies and does not enforce.
  state: () => ({ nodes: [], eweight: [], traj: null, energy: null, peak: 1, accent: ACCENTS[0] }),

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

      // The medium thickens over FRAMES * SUB substeps. Frame k shows the system
      // after k * SUB of them, and the last frame after all of them, at rest: the
      // SUB more that the last interval spans move no node much more than a
      // hundredth of a design unit, a hundredth of its travel over one frame
      // mid-film.
      const STEPS = FRAMES * SUB;
      let frame = 1, acc = 0, taken = 0;
      for (let step = 0; step < STEPS; step++) {
        // Neither the ceiling nor the viscosity touches the forces, so the
        // equilibrium the system is heading for never moves while it settles.
        // A piece that cools by weakening its own forces is chasing a target it
        // is also dragging.
        const p = step / (STEPS - 1);
        const temp = TEMP0 * (1 - p);
        const damp = DAMP0 * (1 - p * p);
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
          let sx = vx[i];
          let sy = vy[i];
          const sp = Math.sqrt(sx * sx + sy * sy);
          if (sp > temp) { const k = temp / sp; sx *= k; sy *= k; }
          px[i] += sx; py[i] += sy;
          sum += Math.sqrt(sx * sx + sy * sy);
        }
        acc += sum / N;
        taken++;

        if (step + 1 === (frame < LAST ? frame * SUB : STEPS)) {
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
    // and dark; a compressed one is drawn pale and thin. At rest the three
    // bridges are the only edges still loaded, so the picture reports the
    // structure it found rather than merely displaying it.
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
    // being revealed; a shortening one is a pen slowing down, and when the
    // system arrives the trails are gone rather than transparent.
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
    // piece finishing, and a reader can point at it.
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

  // Heard, and continuously. Every control is set on every drawn frame, at that
  // frame's second, from the snapshot that frame shows, and ramps linearly to
  // the next. The sound is sampled from the trajectory the picture is drawn
  // from, at the rate it is drawn, so the two cannot drift apart.
  sound(ctx, s, timeline) {
    const N = s.nodes.length;
    const top = Math.max(...s.nodes.map((nd) => nd.deg));
    // A voice is as loud as its disc is large, so the ear, like the eye, is sent
    // to the nodes doing the most work.
    const area = s.nodes.map((nd) => radius(nd) ** 2);
    const sum = area.reduce((a, b) => a + b, 0);
    // How far each voice may pan: nothing for the root and its octave, then a
    // share of WIDTH that grows by octaves up to the highest harmonic.
    const reach = s.nodes.map((nd) => WIDTH * Math.max(0, Math.log2((top + 1 - nd.deg) / 2)) / Math.log2(top / 2));
    // The room is centred on the voices that may move in it, weighted by their
    // power and their reach, so the heaviest cannot pull the whole mix aside.
    const pull = area.map((a, i) => a * a * reach[i]);
    const weight = pull.reduce((a, b) => a + b, 0);

    const bus = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    bus.connect(tone);
    tone.connect(ctx.destination);

    const voices = s.nodes.map((nd, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = ROOT * (top + 1 - nd.deg);
      const level = ctx.createGain();
      level.gain.value = (LEVEL * area[i]) / sum;
      const place = ctx.createStereoPanner();
      osc.connect(level);
      level.connect(place);
      place.connect(bus);
      osc.start(0);
      return { osc, place };
    });

    for (let k = 0; k < timeline.frames; k++) {
      const sec = k / timeline.hz;
      const ramp = k === 0 ? 'setValueAtTime' : 'linearRampToValueAtTime';
      // Silent while the motion is too slow to hear: the first frame, before the
      // first step, and the last few, as the medium stops everything. Full level
      // is the displacement ceiling, the most the trace can ever read, and not
      // this run's own peak: a calmer system sounds calmer instead of being
      // scaled up to full.
      const heard = Math.max(0, Math.log(s.energy[k] / STILL)) / Math.log(TEMP0 / STILL);
      bus.gain[ramp](heard, sec);
      tone.frequency[ramp](DARK * (BRIGHT / DARK) ** heard, sec);
      let mid = 0;
      for (let i = 0; i < N; i++) mid += pull[i] * at(s, k, i)[0];
      mid /= weight;
      for (let i = 0; i < N; i++) {
        const [x, y] = at(s, k, i);
        // Above where it comes to rest on the last frame is sharp and below is
        // flat; to one side of that middle is to that side of the room.
        const lift = at(s, LAST, i)[1] - y;
        voices[i].osc.detune[ramp](CENTS * Math.asinh(lift / NEAR), sec);
        voices[i].place.pan[ramp](reach[i] * Math.max(-1, Math.min(1, (x - mid) / EX)), sec);
      }
    }
  },
};

/** Where node i stands on drawn frame `frame`. The build stores one snapshot
 *  per drawn frame, so frame k shows snapshot k. `draw` and `sound` both read
 *  through here, so the picture and the soundtrack cannot sample the trajectory
 *  differently. */
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
