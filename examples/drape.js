// drape -- cords hung between nails and let fall across three pegs, drawn
// where they came to rest.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. It is a still made by
// a simulation: nothing in the picture is placed by hand except the nails and
// the pegs. The cords fall for six seconds of simulated time in the build,
// `core/sim.js` keeping every bead of a cord within a rope link of its
// neighbours, which pulls but never pushes, and every bead off the pegs, and
// only the last frame is drawn. A still has no clock, so the solve runs on its
// own frames and the piece shows where they ended.
//
// A cord is a chain of beads whose two end beads are held, and a peg is a held
// particle with a radius. How much slack the cords have and how far apart the
// pegs stand decide every curve.

'use strict';

const { rng } = require('../core/rand.js');
const { mix } = require('../core/colour.js');
const { simulate, chain } = require('../core/sim.js');

const W = 900;
const H = 640;
const CORDS = 6;
// Only beads touch anything, so the cord between two beads can cut into a peg
// as deep as its sagitta: beads far closer than a peg is wide keep it on top.
// A bead a little wider than the drawn cord's half-width takes up that
// sagitta, so the cord lies on a peg rather than in it.
const BEADS = 54;
const BEAD = 4.5;
const FLOOR = 600;             // where the wall meets the floor, drawn only
const NAIL_GAP = 10;           // how far a nail stands clear of the nearest peg's bead zone

const GROUND = '#1f2a36';
const PEG = '#b8893a';
const COLOURS = ['#e8dcc2', '#c8643f', '#8fb1a8', '#e2b04a', '#b7a2c9', '#d9d4c7'];

module.exports = {
  name: 'drape',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 4,
  params: {
    slack: { min: 1, max: 1.8, value: 1.5,
      meaning: 'how much longer each cord is than the gap between its nails, so how low it hangs' },
    spread: { min: 0.5, max: 1, value: 0.85,
      meaning: 'how far apart the pegs stand across the width of the picture' },
  },

  state: () => ({ pegs: null, hung: null, run: null, cords: null }),

  build: [
    ['set the pegs', (s) => {
      const R = rng(s.seed);
      // Three pegs across the picture, spaced by `spread` about the middle, in
      // its lower half at seeded heights, one of them always low.
      const low = Math.floor(R('peg', 'low', 0) * 3);
      s.pegs = [-1, 0, 1].map((k) => ({
        x: W / 2 + k * 280 * s.params.spread + (R('peg', 'x', k + 1) - 0.5) * 50,
        y: (k + 1 === low ? 450 : 300) + R('peg', 'y', k + 1) * 110,
        radius: 24 + R('peg', 'size', k + 1) * 20,
      }));
    }],

    ['hang the cords', (s) => {
      const R = rng(s.seed);
      // Each cord hung from a nail on either side of one peg, higher than it,
      // laid straight between them, and let go: it sags by its slack onto the
      // peg, and its nails keep it from sliding off. Two cords to each peg, so
      // every peg carries one; a long cord may cross a neighbour's peg too.
      const beads = [];
      const links = [];
      s.cords = [];
      // A low peg's nails can fall inside a higher peg, and a cord laid straight
      // from them can cross it: the peg then pushes its beads out on both sides
      // and the link between them stays across it. So a bead that starts inside
      // a peg starts on its top instead, and a nail stands NAIL_GAP above that,
      // so no nail is drawn on a peg. Lifting off one peg can land a point in
      // another, so it lifts until no peg holds it.
      const above = (x, y, gap = 0) => {
        for (;;) {
          const p = s.pegs.find((q) => Math.hypot(x - q.x, y - q.y) < q.radius + BEAD + 1 + gap - 1e-9);
          if (!p) return y;
          const clear = p.radius + BEAD + 1 + gap;
          y = p.y - Math.sqrt(clear * clear - (x - p.x) ** 2);
        }
      };
      for (let k = 0; k < CORDS; k++) {
        const first = beads.length;
        const peg = s.pegs[k % s.pegs.length];
        const span = 360 + R('cord', 'span', k) * 200;
        const mid = peg.x + (R('cord', 'shift', k) - 0.5) * span * 0.35;
        const nail = (side, name) => {
          const x = Math.min(W - 24, Math.max(24, mid + side * span / 2));
          return [x, above(x, Math.max(28, peg.y - 150 - R('nail', name, k) * 130), NAIL_GAP)];
        };
        const a = nail(-1, 'left');
        const b = nail(1, 'right');
        for (let i = 0; i < BEADS; i++) {
          const u = i / (BEADS - 1);
          const end = i === 0 || i === BEADS - 1;
          const x = a[0] + (b[0] - a[0]) * u;
          beads.push({ x, y: above(x, a[1] + (b[1] - a[1]) * u), radius: BEAD, group: 1, hold: end ? Infinity : 0 });
        }
        const step = Math.hypot(b[0] - a[0], b[1] - a[1]) / (BEADS - 1);
        links.push(...chain(first, BEADS).map(([p, q]) => [p, q, step * s.params.slack, 'rope']));
        s.cords.push({ first, a, b, colour: COLOURS[Math.floor(R('cord', 'colour', k) * COLOURS.length)] });
      }
      s.hung = { beads, links };
    }],

    ['drop the cords', (s) => {
      const { beads, links } = s.hung;
      s.run = simulate({
        frames: 144, hz: 24, substeps: 6, iterations: 4,
        gravity: [0, 900], drag: 2.2,
        particles: [...beads, ...s.pegs.map((p) => ({ ...p, hold: Infinity }))],
        links,
        restitution: 0, friction: 0.6,
      });
    }],
  ],

  draw(g, s) {
    const last = s.run.frames - 1;
    g.fillStyle = GROUND;
    g.fillRect(0, 0, W, H);
    g.fillStyle = mix(GROUND, '#000000', 0.25);
    g.fillRect(0, FLOOR, W, H - FLOOR);

    // Through the midpoints between beads, turning at each bead, so a cord
    // bends round a peg without corners and never nearer it than its links.
    const trace = (c, dx, dy) => {
      const at = (b) => s.run.at(last, c.first + b);
      g.beginPath();
      let [x, y] = at(0);
      g.moveTo(x + dx, y + dy);
      for (let b = 1; b < BEADS - 1; b++) {
        const [nx, ny] = at(b + 1);
        [x, y] = at(b);
        g.quadraticCurveTo(x + dx, y + dy, (x + nx) / 2 + dx, (y + ny) / 2 + dy);
      }
      [x, y] = at(BEADS - 1);
      g.lineTo(x + dx, y + dy);
      g.stroke();
    };

    // The light comes from the upper left: shadows fall down and to the right.
    const shadow = mix(GROUND, '#000000', 0.45);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = shadow;
    g.lineWidth = 6;
    for (const c of s.cords) trace(c, 10, 13);
    g.fillStyle = shadow;
    for (const p of s.pegs) { g.beginPath(); g.arc(p.x + 10, p.y + 13, p.radius, 0, Math.PI * 2); g.fill(); }

    for (const p of s.pegs) {
      g.fillStyle = PEG;
      g.beginPath(); g.arc(p.x, p.y, p.radius, 0, Math.PI * 2); g.fill();
      g.fillStyle = mix(PEG, '#fff4dc', 0.35);
      g.beginPath(); g.arc(p.x - p.radius * 0.3, p.y - p.radius * 0.3, p.radius * 0.45, 0, Math.PI * 2); g.fill();
    }

    // Each cord a dark edge, then its colour, then a thin lit line along its
    // upper side, in the order they were hung.
    for (const c of s.cords) {
      g.strokeStyle = mix(c.colour, '#000000', 0.55);
      g.lineWidth = 7;
      trace(c, 0, 0);
      g.strokeStyle = c.colour;
      g.lineWidth = 4.6;
      trace(c, 0, 0);
      g.strokeStyle = mix(c.colour, '#ffffff', 0.45);
      g.lineWidth = 1.2;
      trace(c, -0.8, -1.1);
    }
    // The nails, over the cords they hold.
    for (const c of s.cords) {
      for (const [x, y] of [c.a, c.b]) {
        g.fillStyle = mix(PEG, '#000000', 0.35);
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = mix(PEG, '#fff4dc', 0.3);
        g.beginPath(); g.arc(x - 1.2, y - 1.4, 2.2, 0, Math.PI * 2); g.fill();
      }
    }
  },
};
