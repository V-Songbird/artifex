// cascade -- bodies meet: discs let go one by one tumble down three tuned
// ledges, through a hanging thread and into a basin, and every impact is heard
// where and when it lands.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. `settle` relaxes one
// system of springs toward rest; here the parts are separate bodies that touch,
// bounce, roll and pile, and what happens is decided by who hits whom. The whole
// run is solved once in the build by `core/sim.js`, and `draw` only looks up
// the frame. The solver's contact log is the score: each ring drawn and each
// note heard is one logged impact, on the frame it happened, so the picture and
// the soundtrack cannot disagree about when.
//
// THE LEDGES ARE TUNED. Each ledge is a wooden bar with its own note, so the
// cascade plays a phrase as the discs go down it; a disc striking another
// clicks, a bead of the thread rings like glass. How hard a body lands sets how
// loud and bright its note is, and where it lands sets where it is heard.

'use strict';

const { rng } = require('../core/rand.js');
const { mix } = require('../core/colour.js');
const { simulate, chain } = require('../core/sim.js');
const { voice, room, sumInto } = require('../core/sound.js');

const W = 960;
const H = 540;
// The timeline. The build is not handed the clock, so the solve runs on these;
// `time` below says the same.
const DUR = 9;
const HZ = 24;
const FRAMES = Math.round(DUR * HZ);
const G = 900;                 // gravity, in design units per second squared
const DISCS = 16;

const PAPER = '#ebe2cf';
const INK = '#2b2520';
const WOOD = '#4a3a2e';
const LIT = '#e7a94e';         // a ledge's wood while its note sounds
const BRASS = '#b8893a';
const COLOURS = ['#c4553a', '#d9a13b', '#3f5f7a', '#7d9a78', '#9a5b6e'];

// The fixed stage: the frame's two sides, three ledges, and a basin whose lip
// carries on from the last ledge. Each ledge is a bar tuned to one note of D
// minor pentatonic; `note` is a MIDI number, null for a side that only thuds.
const WALLS = [
  { from: [0, -200], to: [0, H], note: null, drawn: false },
  { from: [W, -200], to: [W, H], note: null, drawn: false },
  { from: [30, 88], to: [460, 212], note: 62, drawn: true },
  { from: [770, 250], to: [380, 342], note: 57, drawn: true },
  { from: [262, 330], to: [300, 408], note: 60, drawn: true },
  { from: [300, 408], to: [590, 476], note: 53, drawn: true },
  { from: [590, 476], to: [636, 518], note: 50, drawn: true },
  { from: [636, 518], to: [918, 518], note: 45, drawn: true },
  { from: [918, 518], to: [946, 380], note: 48, drawn: true },
];
const PIN = [528, 26];         // where the thread hangs from
const BEADS = 15;              // beads on the thread, the last one a weight
const LINK = 13;               // design units between beads
const hertz = (note) => 440 * 2 ** ((note - 69) / 12);

module.exports = {
  name: 'cascade',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: { duration: DUR, hz: HZ },
  seed: 5,
  params: {
    bounce: { min: 0.1, max: 0.7, value: 0.42,
      meaning: 'how much of its speed a disc keeps when it strikes a ledge or another disc' },
    gap: { min: 0.25, max: 0.5, value: 0.38,
      meaning: 'seconds between one disc letting go and the next' },
  },

  state: () => ({ bodies: null, run: null, turn: null, hits: null, glow: null }),

  build: [
    ['place the bodies', (s) => {
      const R = rng(s.seed);
      // The discs wait in a column above the frame, 50 apart, more than any
      // two radii, and let go from the bottom up, so each falls clear of the
      // ones still waiting. The seed sizes, colours and places them.
      const discs = [];
      for (let k = 0; k < DISCS; k++) {
        const radius = 13 + Math.floor(R('disc', 'size', k) * 4) * 3;
        discs.push({
          x: 90 + (R('disc', 'jitter', k) - 0.5) * 70,
          y: -40 - k * 50,
          radius,
          mass: (radius / 12) ** 2,
          hold: 0.15 + k * s.params.gap,
          colour: COLOURS[Math.floor(R('disc', 'colour', k) * COLOURS.length)],
        });
      }
      // The thread: a held pin, then beads that do not touch one another, the
      // last one heavier and larger, a weight that swings.
      const thread = [{ x: PIN[0], y: PIN[1], hold: Infinity, group: 1 }];
      for (let b = 1; b <= BEADS; b++) {
        const last = b === BEADS;
        thread.push({ x: PIN[0], y: PIN[1] + b * LINK, radius: last ? 7 : 2.5, mass: last ? 1.6 : 0.25, group: 1 });
      }
      s.bodies = { discs, thread, first: DISCS };
    }],

    ['drop them', (s) => {
      const { discs, thread, first } = s.bodies;
      s.run = simulate({
        frames: FRAMES, hz: HZ, substeps: 10, iterations: 4,
        gravity: [0, G],
        particles: [...discs, ...thread].map(({ colour, ...p }) => p),
        links: chain(first, BEADS + 1),
        walls: WALLS.map((w) => ({ from: w.from, to: w.to, restitution: s.params.bounce, friction: 0.04 })),
        restitution: s.params.bounce,
        friction: 0.1,
        quiet: 60,
      });
      // How far each disc has turned by each frame, as if it rolled every
      // step it moved: the solver has no spin, but a mark that turns with the
      // travel reads as a disc rolling.
      const turn = new Float64Array(FRAMES * DISCS);
      for (let f = 1; f < FRAMES; f++) {
        for (let k = 0; k < DISCS; k++) {
          const dx = s.run.at(f, k)[0] - s.run.at(f - 1, k)[0];
          turn[f * DISCS + k] = turn[(f - 1) * DISCS + k] + dx / discs[k].radius;
        }
      }
      s.turn = turn;
    }],

    ['hear the hits', (s) => {
      // One hit per logged impact, but a body heard at most once every three
      // frames: a disc settling in a pile would otherwise chatter.
      const last = new Map();
      const hits = [];
      for (const c of s.run.contacts) {
        const who = [c.a, c.b === null ? -1 - c.wall : c.b];
        if (who.some((k) => last.has(k) && c.frame - last.get(k) < 3)) continue;
        who.forEach((k) => last.set(k, c.frame));
        const disc = c.a < DISCS ? c.a : c.b !== null && c.b < DISCS ? c.b : -1;
        const kind = c.b === null ? 'wall' : c.a < DISCS && c.b < DISCS ? 'disc' : 'thread';
        hits.push({ frame: c.frame, x: c.x, y: c.y, speed: c.speed, kind, wall: c.wall, disc,
          bead: kind === 'thread' ? Math.max(c.a, c.b) - s.bodies.first : 0 });
      }
      s.hits = hits;
      // A ledge lights while its note sounds: struck, its wood warms by how
      // hard, and cools over about a third of a second, like a key that rings.
      const glow = new Float64Array(FRAMES * WALLS.length);
      for (const h of hits) {
        if (h.kind !== 'wall') continue;
        const heat = Math.min(1, h.speed / 600);
        for (let f = h.frame; f < Math.min(FRAMES, h.frame + HZ); f++) {
          const o = f * WALLS.length + h.wall;
          glow[o] = Math.min(1, glow[o] + heat * Math.exp(-(f - h.frame) / (0.3 * HZ)));
        }
      }
      s.glow = glow;
    }],
  ],

  draw(g, s, _t, clock) {
    const f = clock.frame;
    const { discs, first } = s.bodies;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    // The light is high on the left: every body casts its shadow down and to
    // the right onto the paper behind it.
    const shade = mix(PAPER, INK, 0.2);
    g.fillStyle = shade;
    for (const w of WALLS) if (w.drawn) slab(g, w, 7, 9);
    for (let k = 0; k < DISCS; k++) {
      const [x, y] = s.run.at(f, k);
      g.beginPath();
      g.arc(x + 6, y + 8, discs[k].radius, 0, Math.PI * 2);
      g.fill();
    }

    // The ledges: a bar of wood with a lighter top edge where the light falls,
    // warmed while it rings.
    WALLS.forEach((w, j) => {
      if (!w.drawn) return;
      g.fillStyle = mix(WOOD, LIT, 0.75 * s.glow[f * WALLS.length + j]);
      slab(g, w, 0, 0);
      g.strokeStyle = mix(WOOD, PAPER, 0.45);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(w.from[0], w.from[1] + 0.8);
      g.lineTo(w.to[0], w.to[1] + 0.8);
      g.stroke();
    });

    // The rings: each logged impact opens a ring at its point, wider for a
    // harder hit, thinning as it grows, gone in half a second.
    const life = Math.round(0.5 * HZ);
    for (const h of s.hits) {
      const age = f - h.frame;
      if (age < 0 || age >= life) continue;
      const u = (age + 1) / life;
      const reach = 6 + 34 * Math.min(1, h.speed / 700) * Math.sqrt(u);
      g.strokeStyle = h.disc >= 0 ? mix(discs[h.disc].colour, INK, 0.35) : INK;
      g.globalAlpha = 0.75 * (1 - u);
      g.lineWidth = 2.6 * (1 - u) + 0.4;
      g.beginPath();
      g.arc(h.x, h.y, reach, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // The thread, from its pin through every bead, and its weight.
    g.strokeStyle = INK;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(PIN[0], PIN[1]);
    for (let b = 1; b <= BEADS; b++) {
      const [x, y] = s.run.at(f, first + b);
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = INK;
    for (let b = 1; b < BEADS; b++) {
      const [x, y] = s.run.at(f, first + b);
      g.beginPath();
      g.arc(x, y, 2, 0, Math.PI * 2);
      g.fill();
    }
    const [bx, by] = s.run.at(f, first + BEADS);
    ball(g, bx, by, 7, BRASS, 0);
    g.fillStyle = INK;
    // The pin hangs from a bracket fixed to the top edge, so the thread hangs from something.
    g.fillRect(PIN[0] - 16, 0, 32, 4);
    g.fillRect(PIN[0] - 2, 0, 4, PIN[1] - 5);
    g.fillRect(PIN[0] - 9, PIN[1] - 5, 18, 5);
    g.beginPath();
    g.arc(PIN[0], PIN[1], 2.5, 0, Math.PI * 2);
    g.fill();

    // The discs, each lit from the upper left, a mark turning as it rolls.
    for (let k = 0; k < DISCS; k++) {
      const [x, y] = s.run.at(f, k);
      ball(g, x, y, discs[k].radius, discs[k].colour, s.turn[f * DISCS + k]);
    }
  },

  // Each hit is one voice started on the frame the ring opens, all through one
  // room. Additive partials only: a struck bar is its partials, not a noise.
  sound(ctx, s, timeline) {
    const R = rng(s.seed);
    const dry = ctx.createGain();
    const hall = room(ctx, R, 'room', { size: 1.8, bright: 5000, dark: 700 });
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.gain.setValueAtTime(0.9, Math.max(0, timeline.duration - 0.3));
    out.gain.linearRampToValueAtTime(0, timeline.duration);
    sumInto(ctx, [dry, hall], out);
    out.connect(ctx.destination);
    const voices = [];
    const sends = [];
    s.hits.forEach((h, i) => {
      const at = h.frame / timeline.hz;
      const velocity = Math.min(1, 0.15 + h.speed / 900);
      const pan = Math.max(-1, Math.min(1, (h.x / W) * 1.5 - 0.75));
      const size = h.disc >= 0 ? s.bodies.discs[h.disc].radius / 12 : 1;
      let spec;
      if (h.kind === 'wall') {
        const note = WALLS[h.wall].note;
        // A ledge rings at its own note, like a marimba bar: partials near 1,
        // 4 and 10. The frame's sides only thud, low and short.
        spec = note === null
          ? { pitch: 70, partials: [[1, 1], [2.3, 0.2]], decay: 0.25, level: 0.3 * size }
          : { pitch: hertz(note), partials: [[1, 1], [3.93, 0.3], [9.2, 0.07]], decay: 0.9, damp: 0.9, level: 0.26 * size };
      } else if (h.kind === 'disc') {
        spec = { pitch: 1300 / size, partials: [[1, 1], [2.7, 0.35]], decay: 0.12, damp: 1, level: 0.12 };
      } else {
        // A bead rings higher the nearer the thread's weight it is struck.
        spec = { pitch: hertz(81 + [0, 3, 5, 7, 10][h.bead % 5]), partials: [[1, 1], [2.76, 0.25], [5.4, 0.08]],
          detune: 4, decay: 1.4, damp: 0.7, level: 0.1, distance: 0.2 };
      }
      const v = voice(ctx, R, `hit ${i}`, at, { ...spec, velocity, pan, vary: 0.5, attack: 0.003 });
      const send = ctx.createGain();
      send.gain.value = 0.22 + 0.5 * (spec.distance || 0);
      v.connect(send);
      voices.push(v);
      sends.push(send);
    });
    sumInto(ctx, voices, dry);
    sumInto(ctx, sends, hall);
  },
};

/** A ledge as a bar 15 deep hanging under its line, moved by (dx, dy). */
function slab(g, w, dx, dy) {
  const [ax, ay] = w.from;
  const [bx, by] = w.to;
  const len = Math.hypot(bx - ax, by - ay);
  // The side away from the discs: whichever normal points down the page.
  let nx = -(by - ay) / len;
  let ny = (bx - ax) / len;
  if (ny < 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
  const d = 15;
  g.beginPath();
  g.moveTo(ax + dx, ay + dy);
  g.lineTo(bx + dx, by + dy);
  g.lineTo(bx + nx * d + dx, by + ny * d + dy);
  g.lineTo(ax + nx * d + dx, ay + ny * d + dy);
  g.closePath();
  g.fill();
}

/** A disc lit from the upper left, with a mark at `turn` that shows it rolling. */
function ball(g, x, y, r, colour, turn) {
  g.fillStyle = colour;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = mix(colour, '#fff8e8', 0.3);
  g.beginPath();
  g.arc(x - r * 0.28, y - r * 0.3, r * 0.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = mix(colour, INK, 0.5);
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(x, y, r - 0.6, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = mix(colour, INK, 0.55);
  g.beginPath();
  g.arc(x + Math.cos(turn) * r * 0.58, y + Math.sin(turn) * r * 0.58, Math.max(1.2, r * 0.16), 0, Math.PI * 2);
  g.fill();
}
