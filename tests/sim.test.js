'use strict';

// Parts coupled in space: particles, links, walls and the record of impacts.
//
// Each guard here is one a hand-rolled integrator gets wrong without a picture
// showing it: a reflection of a velocity already leaving, a push out of an
// overlap that becomes speed, a step long enough to pass through a wall, a
// resting contact heard on every step.

const test = require('node:test');
const assert = require('node:assert');
const { createHash } = require('node:crypto');

const { simulate, chain, ring, grid } = require('../core/sim.js');
const { validate, solve } = require('../core/piece.js');
const EXAMPLES = require('../examples/index.js');

const G = 900;

/** Total energy of the free particles on a frame: motion plus height under gravity. */
function energy(r, mass, frame, g = G) {
  let e = 0;
  for (let i = 0; i < mass.length; i++) {
    const [, y] = r.at(frame, i);
    const [vx, vy] = r.velocity(frame, i);
    e += mass[i] * (0.5 * (vx * vx + vy * vy) - g * y);
  }
  return e;
}

/** A closed box 400 wide and 400 high, its floor at y = 200. */
const BOX = [
  { from: [-200, 200], to: [200, 200] },
  { from: [-200, -200], to: [-200, 200] },
  { from: [200, -200], to: [200, 200] },
  { from: [-200, -200], to: [200, -200] },
];

/** Discs and a hanging chain in a box: several contacts share a particle on one step. */
function busy(extra = {}) {
  // Two rows of discs apart from one another and from the chain, so the start
  // holds no overlap for the solver to put right.
  const particles = [];
  for (let i = 0; i < 12; i++) {
    particles.push({ x: -170 + (i % 6) * 28, y: -150 + Math.floor(i / 6) * 40, radius: 6 + (i % 4) * 2, mass: 1 + (i % 3), vx: (i % 2 ? 1 : -1) * 90 });
  }
  const first = particles.length;
  for (let i = 0; i < 16; i++) particles.push({ x: 100, y: -190 + i * 12, radius: 2, group: 1, hold: i === 0 ? Infinity : 0 });
  return {
    frames: 96, hz: 24, gravity: [0, G], particles,
    links: chain(first, 16), walls: [...BOX, { from: [-200, 40], to: [-40, 90] }, { from: [200, -10], to: [60, 30] }],
    ...extra,
  };
}

test('simulate: the same input gives the same bytes, positions, velocities and contacts', () => {
  const a = simulate(busy());
  const b = simulate(busy());
  assert.ok(a.contacts.length > 20, `the busy system logged only ${a.contacts.length} contacts`);
  assert.ok(Buffer.from(a.xy.buffer).equals(Buffer.from(b.xy.buffer)), 'positions differ between two runs of one input');
  assert.ok(Buffer.from(a.vxy.buffer).equals(Buffer.from(b.vxy.buffer)), 'velocities differ between two runs of one input');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(b.contacts));
});

test('simulate: testing only near discs gives the same bytes as testing every pair', () => {
  // A pile started deep in its own overlaps, so pushes carry discs across
  // cells within one pass: discs of mixed size, one group that passes through
  // itself, a disc large enough to be kept out of the cells, a disc held on a
  // path, a point that meets only walls, and the busy system's chain.
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const spec = busy();
  for (let i = 0; i < 90; i++) {
    spec.particles.push({ x: -150 + rnd() * 120, y: -100 + rnd() * 120, radius: 2 + rnd() * 12, mass: 0.5 + rnd() * 3, group: i % 7 === 0 ? 2 : 0 });
  }
  spec.particles.push({ x: -60, y: -20, radius: 60, mass: 20 });
  spec.particles.push({ x: 0, y: 0, radius: 9, path: (t) => [-100 + 150 * t, 20 * Math.sin(3 * t)], hold: 2 });
  spec.particles.push({ x: 50, y: -50, vx: 40 });
  // And rope links through part of the pile, which pull its discs together
  // across cells and never push them apart.
  spec.links.push(...chain(28, 12).map((k) => [...k, 'rope']));
  const a = simulate(spec);
  const b = simulate(spec, { everyPair: true });
  assert.ok(a.contacts.length > 200, `the pile logged only ${a.contacts.length} contacts`);
  assert.ok(Buffer.from(a.xy.buffer).equals(Buffer.from(b.xy.buffer)), 'positions differ from testing every pair');
  assert.ok(Buffer.from(a.vxy.buffer).equals(Buffer.from(b.vxy.buffer)), 'velocities differ from testing every pair');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(b.contacts));
});

test('simulate: testing only near walls gives the same bytes as testing every wall', () => {
  // Discs and points dropped through a board of short pegs at every slant,
  // some thrown fast enough to cross a peg in one step, with walls long and
  // short, level, upright and nearly upright, so pushes and catches carry
  // particles across cells within one pass. Some start inside pegs; a disc
  // wider than a cell, one held on a path and one far out, whose box is
  // tested against every wall, join them.
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const walls = [
    { from: [-300, 300], to: [300, 300] },
    { from: [-300, -400], to: [-300, 300] },
    { from: [300, -400], to: [300.001, 300] },
    { from: [-300, 120], to: [-120, 200], restitution: 0.8, friction: 0 },
  ];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 9; c++) {
      const cx = -260 + c * 64 + (r % 2) * 32;
      const cy = -250 + r * 50;
      const a = rnd() * Math.PI;
      walls.push({ from: [cx - 12 * Math.cos(a), cy - 12 * Math.sin(a)], to: [cx + 12 * Math.cos(a), cy + 12 * Math.sin(a)], friction: rnd() });
    }
  }
  const particles = [];
  for (let i = 0; i < 80; i++) {
    const fast = i % 9 === 0;
    particles.push({
      x: -280 + rnd() * 560, y: -390 + rnd() * 380, radius: i % 5 === 0 ? 0 : 1 + rnd() * 6,
      vx: fast ? (rnd() - 0.5) * 4000 : 0, vy: fast ? rnd() * 6000 : 0,
    });
  }
  particles.push({ x: 0, y: -350, radius: 70, mass: 30 });
  particles.push({ x: 0, y: 0, radius: 5, path: (t) => [-200 + 300 * t, -100 + 40 * Math.sin(4 * t)], hold: 1.5 });
  particles.push({ x: 2 ** 40, y: 0, radius: 2, vx: -50 });
  const spec = { frames: 72, hz: 24, gravity: [0, G], particles, walls };
  const a = simulate(spec);
  const b = simulate(spec, { everyPair: true });
  assert.equal(a.wallGrid, true, 'the board was not filed in a wall grid, so this compares nothing');
  assert.equal(b.wallGrid, false);
  assert.ok(a.contacts.filter((c) => c.wall !== null).length > 300, 'the board logged too few wall contacts');
  assert.ok(Buffer.from(a.xy.buffer).equals(Buffer.from(b.xy.buffer)), 'positions differ from testing every wall');
  assert.ok(Buffer.from(a.vxy.buffer).equals(Buffer.from(b.vxy.buffer)), 'velocities differ from testing every wall');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(b.contacts));

  // A disc falling past one wall's end is pushed sideways, beyond the box its
  // step spans and out of its cells, 20 wide (twice the disc cells, above the
  // median wall), into an upright wall, and meets that one on the same pass.
  const far = Array.from({ length: 14 }, (_, k) => ({ from: [1000 + 20 * k, 0], to: [1008 + 20 * k, 0] }));
  const pushed = {
    frames: 2, hz: 24, substeps: 1, iterations: 1,
    particles: [{ x: 14.5, y: -7, radius: 5, vy: 144 }],
    walls: [{ from: [-50, -1], to: [14.4, -1] }, { from: [23, -20], to: [23, 20] }, ...far],
  };
  const c = simulate(pushed);
  const d = simulate(pushed, { everyPair: true });
  assert.ok(c.at(1, 0)[0] <= 18 + 1e-9, `the disc ended at x = ${c.at(1, 0)[0]}, inside the upright wall`);
  assert.ok(Buffer.from(c.xy.buffer).equals(Buffer.from(d.xy.buffer)), 'a disc pushed into another wall moved otherwise than testing every wall');
  assert.ok(Buffer.from(c.vxy.buffer).equals(Buffer.from(d.vxy.buffer)), 'a disc pushed into another wall left otherwise than testing every wall');
});

test('simulate: bench:sim\'s pegboard files its walls in a grid, and its wall-free piles do not', () => {
  // The pegboard is the pile bench:sim times wall lookups on; a change to how
  // simulate sizes the grid must not turn it off there unnoticed.
  const { pile } = require('../tools/bench-sim.js');
  for (const [name, grid] of [['pegboard', true], ['uniform', false]]) {
    const { particles, walls } = pile(name);
    const r = simulate({ frames: 1, hz: 24, gravity: [0, G], particles, walls });
    assert.equal(r.wallGrid, grid, `${name} ${grid ? 'did not file' : 'filed'} its ${walls.length} walls in a grid`);
  }
});

test('simulate: many large discs, in cells of their own or with the rest, give the same bytes as testing every pair', () => {
  // More large discs than a few, so small discs look them up in cells: some
  // near the small ones in size, which look the small ones up in cells, and
  // some far larger, which take every disc. Poured from high above into an
  // open box, they start spread out, filed together in the large cells, and
  // pack into the box, where they are filed apart.
  let s = 5;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const particles = [];
  for (let i = 0; i < 100; i++) {
    const radius = i % 5 === 0 ? (i % 25 === 0 ? 40 : i % 10 === 0 ? 11.5 : 13.9) : 2;
    particles.push({ x: -180 + rnd() * 360, y: -3000 + rnd() * 2900, radius, mass: radius / 2, vx: (rnd() - 0.5) * 200, group: i % 11 === 0 ? 3 : 0 });
  }
  const spec = { frames: 84, hz: 24, gravity: [0, G], particles, walls: BOX.slice(0, 3) };
  const a = simulate(spec);
  const b = simulate(spec, { everyPair: true });
  assert.ok(a.contacts.length > 300, `the poured discs logged only ${a.contacts.length} contacts`);
  assert.ok(Buffer.from(a.xy.buffer).equals(Buffer.from(b.xy.buffer)), 'positions differ from testing every pair');
  assert.ok(Buffer.from(a.vxy.buffer).equals(Buffer.from(b.vxy.buffer)), 'velocities differ from testing every pair');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(b.contacts));

  // A large disc that looks up the small cells within its reach, 3 out, is
  // pushed by the heavy disc inside it into another small cell, though not
  // another large one, and then touches a disc 4 cells out on the same pass.
  // Fifty discs packed far off make the cells worth looking up.
  const pushed = {
    frames: 2, hz: 24, substeps: 1, iterations: 1,
    particles: [{ x: 0, y: 0, radius: 4.9, mass: 0.01 }, { x: -3, y: 0, radius: 1, mass: 100 }, { x: 8.5, y: 0, radius: 1 }],
  };
  for (let k = 0; k < 50; k++) pushed.particles.push({ x: 1000 + (k % 7) * 2.5, y: Math.floor(k / 7) * 2.5, radius: 1 });
  const c = simulate(pushed);
  const d = simulate(pushed, { everyPair: true });
  assert.ok(d.at(1, 2)[0] > 8.5, 'the pushed disc never met the disc beyond its cells');
  assert.ok(Buffer.from(c.xy.buffer).equals(Buffer.from(d.xy.buffer)), 'a large disc pushed into another small cell moved otherwise than testing every pair');
  assert.ok(Buffer.from(c.vxy.buffer).equals(Buffer.from(d.vxy.buffer)), 'a large disc pushed into another small cell left otherwise than testing every pair');
  assert.equal(JSON.stringify(c.contacts), JSON.stringify(d.contacts));

  // Sparse, so every disc is filed together in cells about 10 wide: a small
  // disc is pushed by the heavy large disc inside it into the next cell, and
  // then touches a large disc two cells from where it started.
  const together = {
    frames: 2, hz: 24, substeps: 1, iterations: 1,
    particles: [{ x: 9, y: 0, radius: 1, mass: 0.01 }, { x: 8.6, y: 0, radius: 5, mass: 100 }, { x: 20.5, y: 0, radius: 5 }],
  };
  for (let k = 0; k < 10; k++) together.particles.push({ x: 100 * k, y: 1000, radius: 1 });
  const e = simulate(together);
  const f = simulate(together, { everyPair: true });
  assert.ok(f.at(1, 2)[0] > 20.5, 'the pushed small disc never met the large disc two cells on');
  assert.ok(Buffer.from(e.xy.buffer).equals(Buffer.from(f.xy.buffer)), 'a disc pushed into another cell of the discs filed together moved otherwise than testing every pair');
  assert.ok(Buffer.from(e.vxy.buffer).equals(Buffer.from(f.vxy.buffer)), 'a disc pushed into another cell of the discs filed together left otherwise than testing every pair');
  assert.equal(JSON.stringify(e.contacts), JSON.stringify(f.contacts));
});

test('simulate: discs beyond 2^22 cells from the origin still meet, by testing every pair', () => {
  // Discs of radius 1 file in cells about 2 wide, so these start 2^23 cells out.
  const spec = {
    frames: 24, hz: 24,
    particles: [{ x: 2 ** 24, y: 0, radius: 1, vx: 60 }, { x: 2 ** 24 + 30, y: 0, radius: 1, vx: -60 }],
  };
  const a = simulate(spec);
  const b = simulate(spec, { everyPair: true });
  assert.ok(a.contacts.some((c) => c.a === 0 && c.b === 1), 'the two far discs never met');
  assert.ok(Buffer.from(a.xy.buffer).equals(Buffer.from(b.xy.buffer)), 'positions differ from testing every pair');
  assert.ok(Buffer.from(a.vxy.buffer).equals(Buffer.from(b.vxy.buffer)), 'velocities differ from testing every pair');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(b.contacts));
});

test('simulate: energy never grows without input, even at restitution 1 and no friction', () => {
  // A closed box, so nothing falls out; restitution 1 and no drag or friction,
  // so the only thing that could change the total is the solver itself.
  const spec = busy({ restitution: 1, friction: 0, frames: 240, walls: BOX.map((w) => ({ ...w, restitution: 1, friction: 0 })) });
  const mass = spec.particles.map((p) => p.mass || 1);
  const r = simulate(spec);
  // The pinned end is held, so it is left out: it moves nothing and nothing moves it.
  mass[12] = 0;
  const e0 = energy(r, mass, 0);
  let peak = -Infinity;
  for (let f = 0; f < r.frames; f++) peak = Math.max(peak, energy(r, mass, f));
  assert.ok(peak <= e0 + 1e-9 * Math.abs(e0), `energy rose from ${e0} to ${peak}`);
  // Nor passed by a solver that damps: measured from the lowest the particles
  // could lie, on the floor, most of the energy is still there ten seconds on
  // (0.74 of it on this system; the chain's links and the slowest touches,
  // which rest instead of bouncing, take the rest).
  const floor = spec.particles.reduce((s, p, i) => s - mass[i] * G * (200 - (p.radius || 0)), 0);
  const kept = (energy(r, mass, r.frames - 1) - floor) / (e0 - floor);
  assert.ok(kept > 0.6, `only ${kept} of the energy above the floor is left after ten seconds`);
});

test('simulate: energy never grows without input with rope links either', () => {
  // The busy system with its chain made of rope links, which pull but never
  // push, so the chain can bunch up in the box as well as swing.
  const spec = busy({ restitution: 1, friction: 0, frames: 240, walls: BOX.map((w) => ({ ...w, restitution: 1, friction: 0 })) });
  spec.links = spec.links.map((k) => [...k, 'rope']);
  const mass = spec.particles.map((p) => p.mass || 1);
  const r = simulate(spec);
  mass[12] = 0;
  const e0 = energy(r, mass, 0);
  for (let f = 0; f < r.frames; f++) {
    const e = energy(r, mass, f);
    assert.ok(e <= e0 + 1e-9 * Math.abs(e0), `energy rose from ${e0} to ${e} by frame ${f}`);
  }
});

test('simulate: a chain of rope links dropped on its end folds, where plain links stand', () => {
  // Twenty links of 10 standing straight up on a floor at y = 200, let go.
  // Plain links hold the column at its height; rope links let each particle
  // fall onto the one below. The measure is the top particle's height above
  // the floor two seconds on: about 190 of 200 for plain links, which give a
  // little under the column's weight, and under a tenth of 200 for rope.
  const drop = (rope) => {
    const particles = [];
    for (let i = 0; i <= 20; i++) particles.push({ x: 0, y: 200 - i * 10 });
    const links = chain(0, 21).map((k) => (rope ? [...k, 'rope'] : k));
    const r = simulate({ frames: 49, hz: 24, gravity: [0, G], particles, links, walls: [{ from: [-1000, 200], to: [1000, 200] }] });
    return 200 - r.at(48, 20)[1];
  };
  const stood = drop(false);
  const folded = drop(true);
  assert.ok(stood > 180, `the plain chain's top fell to only ${stood} above the floor`);
  assert.ok(folded < 20, `the rope chain's top is still ${folded} above the floor, so it stood`);
  // With its length and stiffness given, a rope link closes that share of a
  // stretch in one relaxation, and leaves two particles closer than it alone.
  const pair = (gap) => {
    const r = simulate({ frames: 2, hz: 24, substeps: 1, iterations: 1, particles: [{ x: 0, y: 0 }, { x: gap, y: 0 }], links: [[0, 1, 5, 0.5, 'rope']] });
    return r.at(1, 1)[0] - r.at(1, 0)[0];
  };
  assert.equal(pair(10), 7.5, `a rope link of length 5 and stiffness 0.5 left two particles 10 apart at ${pair(10)}`);
  assert.equal(pair(2), 2, 'a rope link of length 5 pushed two particles 2 apart');
});

test('simulate: energy never grows in piles of discs struck at once, even at half the default substeps', () => {
  // Seeded piles in a box with two slants: many discs of mixed size and mass
  // thrown together, each pile meeting the ways a solver gains energy where
  // several contacts share a body, where a step ends deep in an overlap, and
  // where a body bounces under a wall. Piles 42, 58 and 158 of one stream.
  const walls = [...BOX, { from: [-200, 40], to: [-40, 90] }, { from: [200, -10], to: [60, 30] }]
    .map((w) => ({ ...w, restitution: 1, friction: 0 }));
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const piles = [];
  for (let k = 0; k <= 158; k++) {
    const pile = [];
    const count = 6 + Math.floor(rnd() * 20);
    for (let i = 0; i < count; i++) {
      const radius = 4 + rnd() * 12;
      pile.push({ x: -180 + (i % 8) * 45 + rnd() * 5, y: -180 + Math.floor(i / 8) * 40, radius, mass: 0.5 + rnd() * 4, vx: (rnd() - 0.5) * 600, vy: (rnd() - 0.5) * 600 });
    }
    piles.push(pile);
  }
  for (const k of [42, 58, 158]) {
    const particles = piles[k];
    const r = simulate({ frames: 120, hz: 24, substeps: 8, gravity: [0, G], particles, walls, restitution: 1, friction: 0 });
    const mass = particles.map((p) => p.mass);
    const e0 = energy(r, mass, 0);
    for (let f = 0; f < r.frames; f++) {
      const e = energy(r, mass, f);
      assert.ok(e <= e0 + 1e-9 * Math.abs(e0), `pile ${k}: energy rose from ${e0} to ${e} by frame ${f}`);
    }
  }
});

test('simulate: a body started inside a wall or another body is pushed out without gaining speed', () => {
  // The push out of an overlap is a correction, not a force: turned into
  // velocity it would fire the two apart.
  const r = simulate({
    frames: 24, hz: 24,
    particles: [{ x: 0, y: 0, radius: 10 }, { x: 6, y: 0, radius: 10 }, { x: 100, y: 3, radius: 10 }],
    walls: [{ from: [0, 0], to: [200, 0] }],
  });
  for (let f = 0; f < r.frames; f++) {
    for (let i = 0; i < 3; i++) {
      const [vx, vy] = r.velocity(f, i);
      assert.ok(Math.hypot(vx, vy) < 1e-6, `frame ${f}: particle ${i} moves at ${Math.hypot(vx, vy)} after being pushed out`);
    }
  }
  const [ax, ay] = r.at(23, 0);
  const [bx, by] = r.at(23, 1);
  assert.ok(Math.hypot(bx - ax, by - ay) >= 20 - 1e-9, 'the two discs were not pushed apart');
  assert.ok(Math.abs(r.at(23, 2)[1]) >= 10 - 1e-9, 'the disc in the wall was not pushed out of it');
});

test('simulate: velocity leaves out the push out of an overlap a step starts in, which the travel between frames shows', () => {
  // A held disc drives a column of eight at 60 units a second with one
  // substep and one relaxation, too few to clear the column's overlaps, so
  // each step starts in some. Putting those right moves the discs without
  // turning into velocity, so a forecast from velocity falls short of where
  // the crowd carries a disc; the travel from the frame before does not.
  const particles = [{ x: -30, y: 0, radius: 10, path: (s) => [-30 + 60 * s, 0] }];
  for (let i = 0; i < 8; i++) particles.push({ x: i * 20, y: 0, radius: 10 });
  const r = simulate({ frames: 24, hz: 24, substeps: 1, iterations: 1, restitution: 0, friction: 0, particles });
  let worst = 0;
  for (let f = 1; f < r.frames; f++) {
    for (let i = 1; i <= 8; i++) {
      const travel = (r.at(f, i)[0] - r.at(f - 1, i)[0]) * r.hz;
      const v = r.velocity(f, i)[0];
      assert.ok(travel >= v - 1e-9, `frame ${f}: disc ${i} travelled ${travel} a second, slower than its velocity ${v}`);
      worst = Math.max(worst, travel - v);
    }
  }
  assert.ok(worst > 5, `the push out of the column's overlaps reached velocity: travel exceeded it by at most ${worst} a second`);
});

test('simulate: no tunnelling through a thin wall at the declared substeps, at any speed', () => {
  // One substep a frame and one relaxation: a point moving 2000 units a step
  // still meets a wall of no thickness where its path crosses it.
  for (const speed of [100, 2400, 48000]) {
    for (const radius of [0, 3]) {
      const r = simulate({
        frames: 12, hz: 24, substeps: 1, iterations: 1, restitution: 0,
        particles: [{ x: 0, y: 0, vx: speed, vy: speed * 0.1, radius }],
        walls: [{ from: [30, -1e6], to: [30, 1e6] }],
      });
      for (let f = 0; f < r.frames; f++) {
        assert.ok(r.at(f, 0)[0] <= 30 - radius, `at ${speed} units a second a particle of radius ${radius} is at x ${r.at(f, 0)[0]} on frame ${f}, past the wall at 30`);
      }
      assert.equal(r.contacts.length, 1, `at ${speed} units a second the wall logged ${r.contacts.length} impacts`);
    }
  }
});

test('simulate: walls whose endpoints follow seconds keep a pile inside a box that shrinks and grows, and carry what rests on them', () => {
  // A floor and two sides whose endpoints are functions of seconds: thirty
  // discs land in a box 400 wide, which narrows to 240 over two seconds and
  // widens back over two more, the floor's ends moving with the sides. On
  // every frame every disc stands inside the walls of that moment, none is
  // pushed through the floor, and the sides log the impacts they make.
  const half = (s) => 200 - 80 * Math.sin((Math.PI * Math.min(Math.max(s - 1, 0), 4)) / 4) ** 2;
  const walls = [
    { from: (s) => [-half(s), 200], to: (s) => [half(s), 200] },
    { from: (s) => [-half(s), -400], to: (s) => [-half(s), 200] },
    { from: (s) => [half(s), -400], to: (s) => [half(s), 200] },
  ];
  const particles = [];
  for (let i = 0; i < 30; i++) particles.push({ x: -165 + (i % 10) * 36.7, y: 150 - Math.floor(i / 10) * 30, radius: 6 + (i % 4) });
  const r = simulate({ frames: 144, hz: 24, gravity: [0, G], particles, walls });
  for (let f = 0; f < r.frames; f++) {
    const w = half(f / 24);
    for (let i = 0; i < 30; i++) {
      const [x, y] = r.at(f, i);
      const rad = particles[i].radius;
      assert.ok(x - rad >= -w - 1e-6 && x + rad <= w + 1e-6, `frame ${f}: disc ${i} at x ${x} is outside the walls at ±${w}`);
      assert.ok(y + rad <= 200 + 1e-6, `frame ${f}: disc ${i} at y ${y} was pushed through the floor`);
    }
  }
  const pushed = r.contacts.filter((c) => (c.wall === 1 || c.wall === 2) && c.seconds > 1 && c.seconds < 3);
  assert.ok(pushed.length > 0, 'the sides logged no impact while they closed');
  for (const c of pushed) {
    assert.ok(c.speed > 0 && Math.abs(c.nx - (c.wall === 1 ? 1 : -1)) < 1e-9 && Math.abs(c.ny) < 1e-9, `a side closing on the pile logged ${JSON.stringify(c)}: its speed is the side's, its normal points into the box`);
  }
  for (let k = 1; k < r.contacts.length; k++) assert.ok(r.contacts[k].seconds >= r.contacts[k - 1].seconds, 'contacts are not in time order');

  // A disc resting on a floor that slides sideways rides with it: sliding
  // friction brings it to the floor's speed, then static friction holds it.
  const belt = simulate({
    frames: 49, hz: 24, gravity: [0, G], friction: 0.5,
    particles: [{ x: 0, y: 190, radius: 10 }],
    walls: [{ from: (s) => [-200 + 50 * s, 200], to: (s) => [200 + 50 * s, 200] }],
  });
  const [bx, by] = belt.at(48, 0);
  assert.ok(Math.abs(bx - 100) < 5, `the disc on the sliding floor reached x ${bx}, not about 100`);
  assert.ok(Math.abs(by - 190) < 1e-6, `and sank to y ${by}`);
  assert.ok(Math.abs(belt.velocity(48, 0)[0] - 50) < 1e-6, `and moves at ${belt.velocity(48, 0)[0]}, not the floor's 50`);
  assert.equal(belt.contacts.length, 0, 'riding the floor is not an impact');
});

test('simulate: a wall that sweeps across a body in one step catches it, filed walls or not', () => {
  // One substep a frame and one relaxation: a wall moving 200 units a step
  // crosses a body at rest in the first step, and the body is on the wall's
  // far side on every frame after, carried at the wall's speed, one impact.
  for (const radius of [0, 3]) {
    const r = simulate({
      frames: 12, hz: 24, substeps: 1, iterations: 1, restitution: 0,
      particles: [{ x: 0, y: 0, radius }],
      walls: [{ from: (s) => [-100 + 4800 * s, -1e6], to: (s) => [-100 + 4800 * s, 1e6] }],
    });
    for (let f = 1; f < r.frames; f++) {
      const edge = -100 + (4800 * f) / 24 + radius;
      assert.ok(r.at(f, 0)[0] >= edge - 1e-6, `a body of radius ${radius} is at x ${r.at(f, 0)[0]} on frame ${f}, behind the wall's edge at ${edge}`);
    }
    assert.equal(r.contacts.length, 1, `the sweeping wall logged ${r.contacts.length} impacts`);
    assert.ok(Math.abs(r.contacts[0].speed - 4800) < 1e-6, `the impact closed at ${r.contacts[0].speed}, not the wall's 4800`);
    assert.equal(r.contacts[0].wall, 0);
  }

  // Among more than eight walls, which are filed in cells, a wall that moves
  // is tested against every particle, and the bytes match testing every wall.
  const walls = [{ from: [-300, 300], to: [300, 300] }];
  for (let c = 0; c < 10; c++) walls.push({ from: [-270 + c * 60, 100 + (c % 3) * 40], to: [-250 + c * 60, 120 + (c % 3) * 40] });
  walls.push({ from: (s) => [-300 + 240 * s, 0], to: (s) => [-300 + 240 * s, 300] });
  let s = 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const particles = [];
  for (let i = 0; i < 40; i++) particles.push({ x: -280 + rnd() * 560, y: -200 + rnd() * 250, radius: i % 5 === 0 ? 0 : 2 + rnd() * 6 });
  const spec = { frames: 72, hz: 24, gravity: [0, G], particles, walls };
  const a = simulate(spec);
  const b = simulate(spec, { everyPair: true });
  assert.equal(a.wallGrid, true, 'the board was not filed in a wall grid, so this compares nothing');
  assert.ok(a.contacts.some((c) => c.wall === 11), 'the moving wall met nothing');
  assert.ok(Buffer.from(a.xy.buffer).equals(Buffer.from(b.xy.buffer)), 'positions differ from testing every wall');
  assert.ok(Buffer.from(a.vxy.buffer).equals(Buffer.from(b.vxy.buffer)), 'velocities differ from testing every wall');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(b.contacts));
});

test('simulate: a chain keeps every link within 2% of its length while it swings', () => {
  // 30 links pinned at one end, released from level: the hardest moment for a
  // chain is the bottom of its first swing. Defaults: 8 substeps, 4 relaxations.
  const particles = [];
  for (let i = 0; i < 31; i++) particles.push({ x: i * 10, y: 0, hold: i === 0 ? Infinity : 0 });
  const r = simulate({ frames: 120, hz: 24, gravity: [0, G], particles, links: chain(0, 31) });
  let worst = 0;
  for (let f = 0; f < r.frames; f++) {
    for (let i = 0; i < 30; i++) {
      const [ax, ay] = r.at(f, i);
      const [bx, by] = r.at(f, i + 1);
      worst = Math.max(worst, Math.abs(Math.hypot(bx - ax, by - ay) - 10) / 10);
    }
  }
  assert.ok(worst < 0.02, `a link strayed ${(worst * 100).toFixed(2)}% from its length`);
  let low = 0;
  for (let f = 0; f < r.frames; f++) low = Math.max(low, r.at(f, 30)[1]);
  assert.ok(low > 250, `the chain's end fell only to ${low}, so it never swung down`);
});

test('simulate: contacts are logged once per impact, with the normal speed they closed at', () => {
  // A disc dropped 200 units lands at sqrt(2 g h) = 600 units a second, bounces
  // lower each time, then rests: every bounce is one contact and resting is none.
  const r = simulate({
    frames: 240, hz: 24, gravity: [0, G], restitution: 0.5,
    particles: [{ x: 0, y: -5, radius: 5, vx: 80 }],
    walls: [{ from: [-1000, 200], to: [1000, 200] }],
  });
  const c = r.contacts;
  assert.ok(Math.abs(c[0].speed - 600) < 6, `the first impact closed at ${c[0].speed}, not 600: only the speed along the normal counts`);
  assert.equal(c[0].wall, 0);
  assert.equal(c[0].b, null);
  assert.equal(c[0].a, 0);
  assert.ok(Math.abs(c[0].nx) < 1e-9 && Math.abs(c[0].ny + 1) < 1e-9, `the floor's normal is [${c[0].nx}, ${c[0].ny}], not up`);
  assert.ok(Math.abs(c[0].y - 200) < 1e-6, `the contact point is at y ${c[0].y}, not on the floor`);
  assert.equal(c[0].frame, Math.ceil(c[0].seconds * 24 - 1e-9), 'a contact names the first frame that shows it');
  for (let k = 1; k < c.length; k++) {
    assert.ok(c[k].speed < c[k - 1].speed, `impact ${k} closed faster than the one before`);
    assert.ok(c[k].seconds > c[k - 1].seconds);
  }
  assert.ok(c.length >= 4 && c.length <= 12, `${c.length} impacts for a bounce that dies at restitution 0.5`);
  // It has come to rest well before the end, and resting logged nothing more.
  const last = c[c.length - 1].seconds;
  assert.ok(last < 5, `the disc was still landing at ${last} s`);
  assert.ok(Math.abs(r.at(239, 0)[1] - 195) < 1e-6, 'and it rests on the floor');

  // Two discs meeting head on: one contact between them, naming both.
  const two = simulate({ frames: 48, hz: 24, particles: [{ x: -50, y: 0, radius: 10, vx: 100 }, { x: 50, y: 0, radius: 10, vx: -100 }] });
  assert.equal(two.contacts.length, 1);
  assert.equal(two.contacts[0].b, 1);
  assert.equal(two.contacts[0].wall, null);
  assert.ok(Math.abs(two.contacts[0].speed - 200) < 1e-6, `they closed at ${two.contacts[0].speed}, not 200`);
  assert.ok(Math.abs(two.contacts[0].x) < 1e-6, 'and met between them');

  // A held pusher speeding up into a disc closes on it again on every step
  // they stay in touch: that is one impact, not one per step.
  const push = simulate({
    frames: 24, hz: 24, restitution: 0,
    particles: [{ x: 0, y: 0, radius: 10, path: (t) => [300 * t * t, 0] }, { x: 30, y: 0, radius: 10 }],
  });
  assert.equal(push.contacts.length, 1, `a pusher held against a disc logged ${push.contacts.length} impacts`);
});

test('simulate: a contact reflects only a velocity that points into the surface', () => {
  // A disc overlapping a floor while already leaving it keeps leaving: reversing
  // it would pull it back into the floor.
  const r = simulate({
    frames: 6, hz: 24, restitution: 1,
    particles: [{ x: 0, y: 195.5, radius: 5, vy: -100 }],
    walls: [{ from: [-100, 200], to: [100, 200] }],
  });
  for (let f = 1; f < r.frames; f++) assert.ok(r.velocity(f, 0)[1] <= -100 + 1e-9, `frame ${f}: the leaving disc turned to ${r.velocity(f, 0)[1]}`);
  assert.equal(r.contacts.length, 0, 'and leaving is not an impact');
  // A disc lifting off a floor slower than gravity pulls it back touches the
  // floor again within the step while its velocity still leaves it: that
  // contact stops it, and never turns it into the floor. One step a frame, so
  // each frame shows what that step's contact did.
  const lift = simulate({
    frames: 6, hz: 384, substeps: 1, restitution: 1, gravity: [0, G],
    particles: [{ x: 0, y: 195, radius: 5, vy: -1 }],
    walls: [{ from: [-100, 200], to: [100, 200] }],
  });
  for (let f = 1; f < lift.frames; f++) assert.ok(lift.velocity(f, 0)[1] <= 1e-9, `frame ${f}: the lifting disc was sent into the floor at ${lift.velocity(f, 0)[1]}`);
});

test('simulate: a contact corrects along the normal, so a body slides down a smooth slope and rests on a rough one', () => {
  const th = 0.4;
  const slope = (mu) => simulate({
    frames: 25, hz: 24, gravity: [0, G], friction: mu,
    particles: [{ x: 0, y: -5 / Math.cos(th), radius: 5 }],
    walls: [{ from: [-1000 * Math.cos(th), -1000 * Math.sin(th)], to: [1000 * Math.cos(th), 1000 * Math.sin(th)] }],
  });
  const smooth = slope(0);
  const [x, y] = smooth.at(24, 0);
  const travel = Math.hypot(x, y + 5 / Math.cos(th));
  const expected = 0.5 * G * Math.sin(th);
  assert.ok(Math.abs(travel - expected) < 0.02 * expected, `on a smooth slope it slid ${travel} in one second, not ${expected}`);
  // Friction above tan(0.4) = 0.42 holds it where it was put.
  const rough = slope(0.6);
  assert.ok(Math.hypot(rough.at(24, 0)[0], rough.at(24, 0)[1] + 5 / Math.cos(th)) < 1e-6, 'friction 0.6 did not hold it on a 0.4 radian slope');
  // Below it, it slides, slowed: sliding friction takes mu g cos from g sin.
  const slow = slope(0.2);
  const [sx, sy] = slow.at(24, 0);
  const want = 0.5 * G * (Math.sin(th) - 0.2 * Math.cos(th));
  assert.ok(Math.abs(Math.hypot(sx, sy + 5 / Math.cos(th)) - want) < 0.05 * want, `at friction 0.2 it slid ${Math.hypot(sx, sy + 5 / Math.cos(th))}, not ${want}`);
});

test('simulate: a collision moves each of two discs by the share its mass leaves it, and keeps their momentum', () => {
  const r = simulate({
    frames: 48, hz: 24, restitution: 1,
    particles: [{ x: -60, y: 0, radius: 10, mass: 1, vx: 120 }, { x: 60, y: 4, radius: 10, mass: 4, vx: -30 }],
  });
  for (const f of [0, 47]) {
    const [ax, ay] = r.velocity(f, 0);
    const [bx, by] = r.velocity(f, 1);
    assert.ok(Math.abs(ax + 4 * bx) < 1e-9 && Math.abs(ay + 4 * by) < 1e-9, `frame ${f}: momentum is ${[ax + 4 * bx, ay + 4 * by]}`);
  }
  assert.equal(r.contacts.length, 1);
  // A disc held in place moves not at all, whatever meets it.
  const held = simulate({ frames: 24, hz: 24, particles: [{ x: -60, y: 0, radius: 10, vx: 200 }, { x: 0, y: 0, radius: 10, hold: Infinity }] });
  assert.deepEqual(held.at(23, 1), [0, 0]);
  assert.ok(held.velocity(23, 0)[0] < 0, 'the free disc did not bounce off the held one');
});

test('simulate: a held particle follows its path, and released keeps the velocity the path gave it', () => {
  const r = simulate({
    frames: 48, hz: 24,
    particles: [{ x: 0, y: 0, path: (s) => [100 * s, 0], hold: 1 }, { x: 0, y: 50, hold: 1 }],
  });
  for (let f = 0; f <= 24; f++) assert.ok(Math.abs(r.at(f, 0)[0] - (100 * f) / 24) < 1e-9, `frame ${f} is off its path`);
  const want = (100 * 47) / 24;
  assert.ok(Math.abs(r.at(47, 0)[0] - want) < 1e-6, `released at 100 units a second it reached ${r.at(47, 0)[0]}, not ${want}`);
  assert.deepEqual(r.at(47, 1), [0, 50], 'and one held with no path stays put, and, without gravity, after too');
});

test('chain, ring and grid write the links of a run, a loop and a sheet', () => {
  assert.deepEqual(chain(3, 4), [[3, 4], [4, 5], [5, 6]]);
  assert.deepEqual(ring(0, 3), [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(grid(1, 3, 2), [[1, 2], [1, 4], [2, 3], [2, 5], [3, 6], [4, 5], [5, 6]]);
  // Each link keeps the distance its two particles start at.
  const particles = [0, 1, 2, 3].map((i) => ({ x: (i % 2) * 30, y: Math.floor(i / 2) * 40 }));
  const r = simulate({ frames: 2, hz: 24, particles, links: grid(0, 2, 2) });
  assert.deepEqual(r.at(1, 3), [30, 40], 'a sheet at rest at its own lengths does not move');
});

test('simulate refuses what it cannot solve, by name', () => {
  const base = { frames: 2, hz: 24, particles: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  const refuse = (extra, pattern) => assert.throws(() => simulate({ ...base, ...extra }), pattern);
  refuse({ restitution: 1.01 }, /simulate: restitution must be from 0 to 1, got 1.01/);
  refuse({ walls: [{ from: [0, 0], to: [1, 0], restitution: 1.5 }] }, /simulate: wall 0 restitution must be from 0 to 1, got 1.5/);
  refuse({ walls: [{ from: [0, 0], to: [0, 0] }] }, /simulate: wall 0 length must be above 0/);
  refuse({ walls: [{ from: () => [NaN, 0], to: [1, 0] }] }, /simulate: wall 0 from must return finite \[x, y\], got \[null,0\] at 0 s/);
  refuse({ walls: [{ from: [0, 0], to: 5 }] }, /simulate: wall 0 to must be \[x, y\], or a function of seconds/);
  refuse({ substeps: 1, walls: [{ from: [0, 0], to: (s) => [s < 1 / 24 ? 1 : 0, 0] }] }, /simulate: wall 0 length must be above 0 at 0\.041\d* s: from and to must differ, got 0/);
  // A floor whose ends close at 31 units a second each pass through each
  // other at 100 / 62 s, between the steps ending at 38 / 24 and 39 / 24 s:
  // swept as a rigid line, it would carry a disc resting on it to its other
  // side, so the step is refused, in time and by name.
  refuse({ frames: 48, substeps: 1, walls: [{ from: (s) => [-50 + 31 * s, 200], to: (s) => [50 - 31 * s, 200] }] }, /simulate: wall 0 reverses its direction at 1\.625 s: its ends pass through each other, or it turns more than a quarter in one step/);
  refuse({ friction: -1 }, /simulate: friction must be a finite number, 0 or more/);
  refuse({ frames: 0 }, /simulate: frames must be a whole number of frames/);
  refuse({ hz: 0 }, /simulate: hz must be frames a second above 0/);
  refuse({ substeps: 0 }, /simulate: substeps must be a whole number from 1 to 1000/);
  refuse({ iterations: 1.5 }, /simulate: iterations must be a whole number from 1 to 1000/);
  refuse({ gravity: [0] }, /simulate: gravity must be \[gx, gy\]/);
  refuse({ drag: -0.1 }, /simulate: drag must be a finite number per second/);
  refuse({ particles: [] }, /simulate: particles must be a non-empty list/);
  refuse({ particles: [{ x: 0, y: NaN }] }, /simulate: particle 0 y must be a finite number, got NaN/);
  refuse({ particles: [{ x: 0, y: 0, mass: 0 }] }, /simulate: particle 0 mass must be a finite number above 0/);
  refuse({ particles: [{ x: 0, y: 0, hold: 1, vx: 5 }] }, /simulate: particle 0 is held, so it starts at rest/);
  refuse({ particles: [{ x: 0, y: 0, path: 3 }] }, /simulate: particle 0 path must be a function/);
  refuse({ links: [[0, 0]] }, /simulate: link 0 b must be another particle index/);
  refuse({ links: [[0, 2]] }, /simulate: link 0 b must be another particle index from 0 to 1, got 2/);
  refuse({ links: [[0, 1, 5, 1, 1]] }, /simulate: link 0 must be \[a, b\], \[a, b, length\] or \[a, b, length, stiffness\], with 'rope' last/);
  refuse({ links: [[0, 1, 'slack']] }, /simulate: link 0 length must be a finite distance above 0; two particles that start together need one, got slack/);
  refuse({ links: [[0, 1, 5, 0]] },/simulate: link 0 stiffness must be above 0 and at most 1/);
  refuse({ particles: [{ x: 0, y: 0 }, { x: 0, y: 0 }], links: [[0, 1]] }, /simulate: link 0 length must be a finite distance above 0/);
  assert.throws(() => simulate({ ...base, particles: [{ x: 0, y: 0, path: () => [NaN, 0] }] }), /simulate: particle 0 path must return finite \[x, y\]/);
  assert.throws(() => simulate(null), /simulate: needs an object of its keys/);
  const r = simulate(base);
  assert.throws(() => r.at(2, 0), /simulate: at needs a whole frame from 0 to 1, got 2/);
  assert.throws(() => r.velocity(0, 5), /simulate: velocity needs a particle index from 0 to 1, got 5/);
});

// Bodies that turn: boxes and convex shapes, solved by the vendored planck.

const FLOOR = { from: [-1000, 200], to: [1000, 200] };

/** Five boxes of side 40 stacked on the floor, and a sixth, twice as heavy, thrown at the top one. */
function stack() {
  const bodies = [];
  for (let k = 0; k < 5; k++) bodies.push({ x: 0, y: 200 - 40 * (k + 0.5), width: 40, height: 40 });
  bodies.push({ x: -200, y: 30, width: 40, height: 40, vx: 600, vy: -100, mass: 2 });
  return { frames: 144, hz: 24, gravity: [0, G], bodies, walls: [FLOOR], friction: 0.5, restitution: 0.1 };
}

const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

test('simulate: bodies give the same bytes for the same input, after any other solve', () => {
  const a = simulate(stack());
  const b = simulate(stack());
  assert.ok(a.contacts.length > 10, `the toppled stack logged only ${a.contacts.length} contacts`);
  assert.ok(same(a.poses, b.poses), 'poses differ between two solves of one input');
  assert.ok(same(a.motions, b.motions), 'motions differ between two solves of one input');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(b.contacts));
  // Another solve in between leaves nothing behind that moves the next one.
  simulate({ frames: 30, hz: 24, gravity: [0, G], walls: [FLOOR], bodies: [{ x: 0, y: 0, points: [[0, -30], [25, 20], [-25, 20]], spin: 3 }] });
  const c = simulate(stack());
  assert.ok(same(a.poses, c.poses) && same(a.motions, c.motions), 'a solve after another spec differs');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(c.contacts));
});

test('simulate: a spec without bodies gives the bytes it gave before bodies existed', () => {
  // The pinned digests below hold the bytes; an empty list of bodies changes nothing.
  const a = simulate(busy());
  const b = simulate(busy({ bodies: [] }));
  assert.ok(same(a.xy, b.xy) && same(a.vxy, b.vxy), 'bodies: [] moved the particles');
  assert.equal(JSON.stringify(a.contacts), JSON.stringify(b.contacts));
  assert.equal(b.bodies, 0);
  assert.equal(b.poses.length, 0);
});

test('simulate: a stack of boxes struck at the top turns, topples onto its faces and rests, never sinking into the floor', () => {
  const r = simulate(stack());
  assert.equal(r.bodies, 6);
  let turned = 0;
  let deepest = -Infinity;
  for (let k = 0; k < r.bodies; k++) {
    if (Math.abs(r.pose(r.frames - 1, k)[2] - r.pose(0, k)[2]) > Math.PI / 8) turned++;
    for (let f = 0; f < r.frames; f++) {
      const [, y, a] = r.pose(f, k);
      for (const [u, v] of [[-20, -20], [20, -20], [20, 20], [-20, 20]]) deepest = Math.max(deepest, y + u * Math.sin(a) + v * Math.cos(a) - 200);
    }
  }
  assert.ok(turned >= 3, `only ${turned} boxes turned more than an eighth of a half turn`);
  assert.ok(deepest <= 1, `a box corner went ${deepest} units into the floor`);
  for (let k = 0; k < r.bodies; k++) {
    const [, , a] = r.pose(r.frames - 1, k);
    const [vx, vy] = r.motion(r.frames - 1, k);
    const off = Math.abs(a - Math.round(a / (Math.PI / 2)) * (Math.PI / 2));
    assert.ok(off < 0.05, `box ${k} ends ${off} rad off a face`);
    assert.ok(Math.hypot(vx, vy) < 5, `box ${k} still moves at ${Math.hypot(vx, vy)} units a second`);
  }
});

test('simulate: a body bouncing at restitution 1 gains no energy, turning included', () => {
  // A box 60 by 30 dropped tilted 200 units onto a smooth floor. Measured with
  // planck 1.5.1: the energy rises by at most 0.72 % of what the fall gives.
  const r = simulate({
    frames: 96, hz: 24, gravity: [0, G], restitution: 1, friction: 0, walls: [FLOOR],
    bodies: [{ x: 0, y: 0, width: 60, height: 30, angle: 0.4 }],
  });
  const inertia = (60 * 60 + 30 * 30) / 12;
  const energy = (f) => {
    const [, y] = r.pose(f, 0);
    const [vx, vy, spin] = r.motion(f, 0);
    return 0.5 * (vx * vx + vy * vy) + 0.5 * inertia * spin * spin - G * y;
  };
  assert.ok(r.contacts.length >= 2, 'the box never bounced');
  let worst = -Infinity;
  for (let f = 0; f < r.frames; f++) worst = Math.max(worst, (energy(f) - energy(0)) / (G * 200));
  assert.ok(worst <= 0.01, `the energy rose by ${(worst * 100).toFixed(2)} % of the fall's`);
});

test('simulate: a body bounces at restitution 1 whatever its size', () => {
  // planck's own threshold, 1 unit a second in its units, is the bodies' median
  // size in design units: a box of side 300 thrown at 300 units a second would rest.
  for (const side of [2, 20, 300, 1000]) {
    for (const [g, vy, fall] of [[G, 0, 600], [0, 300, 300]]) {
      const r = simulate({
        frames: 48, hz: 24, gravity: [0, g], restitution: 1, friction: 0,
        walls: [{ from: [-5000, 200 + side], to: [5000, 200 + side] }], bodies: [{ x: 0, y: side / 2, width: side, height: side, vy }],
      });
      let rise = 0;
      for (let f = 0; f < r.frames; f++) rise = Math.max(rise, -r.motion(f, 0)[1]);
      assert.ok(rise > 0.9 * fall, `a box of side ${side} falling at ${fall} under gravity ${g} rose at only ${rise}`);
    }
  }
});

test('simulate: a body logs one contact per impact, naming the body and what it struck', () => {
  // A box dropped flat from rest 180 units lands at sqrt(2 g h), then rests.
  const r = simulate({ frames: 72, hz: 24, gravity: [0, G], restitution: 0, walls: [FLOOR], bodies: [{ x: 0, y: 0, width: 40, height: 40 }] });
  assert.equal(r.contacts.length, 1, `a box that lands once and rests logged ${r.contacts.length} contacts`);
  const [c] = r.contacts;
  const fall = Math.sqrt(2 * G * 180);
  assert.ok(Math.abs(c.speed - fall) < 0.05 * fall, `it closed at ${c.speed}, not ${fall}`);
  assert.ok(Math.abs(c.nx) < 1e-9 && Math.abs(c.ny + 1) < 1e-9, `the normal is [${c.nx}, ${c.ny}], not towards the box`);
  assert.deepEqual([c.body, c.other, c.wall, c.a, c.b], [0, null, 0, null, null]);
  assert.equal(c.frame, Math.ceil(c.seconds * 24 - 1e-9), 'a contact names the first frame that shows it');

  const two = simulate({ frames: 48, hz: 24, bodies: [{ x: -100, y: 0, width: 40, height: 40, vx: 200 }, { x: 100, y: 0, width: 40, height: 40 }] });
  assert.equal(two.contacts.length, 1);
  const [d] = two.contacts;
  assert.deepEqual([d.body, d.other, d.wall], [0, 1, null]);
  assert.ok(Math.abs(d.speed - 200) < 1e-6 && Math.abs(d.nx + 1) < 1e-9, `they closed at ${d.speed} along [${d.nx}, ${d.ny}]`);

  // With particles, each log keeps its order, the particles' first within a step.
  const both = simulate({ frames: 48, hz: 24, gravity: [0, G], walls: [FLOOR], particles: [{ x: 300, y: 0, radius: 5 }], bodies: [{ x: 0, y: 0, width: 40, height: 40 }] });
  assert.ok(both.contacts.some((e) => e.a === 0) && both.contacts.some((e) => e.body === 0), 'one of the two logs is missing');
  for (let k = 1; k < both.contacts.length; k++) assert.ok(both.contacts[k].seconds >= both.contacts[k - 1].seconds, `contact ${k} is out of time order`);
  assert.ok(both.contacts.filter((e) => e.a === 0).every((e) => !('body' in e)), 'a particle contact gained body keys');
});

test('simulate: a body that lands again while still touching logs that impact once', () => {
  // A tall box spun on its end pivots on one corner and slams its far end
  // down about frame 21; a tilted slab lands on a corner at frame 15, then
  // slaps flat. Both stay in contact with the floor throughout.
  const tall = simulate({ frames: 96, hz: 24, gravity: [0, G], restitution: 0.3, friction: 0.8, walls: [FLOOR], bodies: [{ x: 0, y: 160, width: 20, height: 80, spin: 5 }] });
  const slam = tall.contacts.filter((c) => c.frame >= 19 && c.frame <= 23);
  assert.equal(slam.length, 1, `the tall box's slam logged ${slam.length} contacts between frames 19 and 23`);
  assert.ok(slam[0].speed > 200 && slam[0].x > 60, `the slam closed at ${slam[0].speed} at x ${slam[0].x}, not at the far end`);
  assert.ok(tall.contacts.length <= 6, `the tall box logged ${tall.contacts.length} contacts`);
  assert.ok(tall.contacts.every((c) => c.frame < 30), 'the tall box logged a contact while it rests');

  const slab = simulate({ frames: 72, hz: 24, gravity: [0, G], restitution: 0, friction: 0.8, walls: [FLOOR], bodies: [{ x: 0, y: 0, width: 120, height: 20, angle: 0.5 }] });
  assert.deepEqual(slab.contacts.map((c) => [c.frame, c.body, c.wall]), [[15, 0, 0], [17, 0, 0]], 'the slab logs its corner and its slap flat, then nothing while it rests');
  assert.ok(slab.contacts[1].speed > 300 && slab.contacts[1].x < -40, `the slap closed at ${slab.contacts[1].speed} at x ${slab.contacts[1].x}, not at the far corner`);
});

test('simulate: a held body stands until its hold ends, and letting it go where it rests logs nothing', () => {
  // A box held in the air with another resting on it: still to frame 24, the
  // end of its hold, falling from frame 25, and the pair lands once.
  const air = simulate({ frames: 48, hz: 24, gravity: [0, G], walls: [FLOOR], bodies: [{ x: 0, y: 0, width: 40, height: 40, hold: 1 }, { x: 0, y: -40, width: 40, height: 40 }] });
  assert.deepEqual(air.pose(24, 0), [0, 0, 0], 'the held box moved before its hold ended');
  assert.ok(air.pose(25, 0)[1] > 0, 'the held box did not fall when its hold ended');
  assert.ok(Math.abs(air.pose(24, 1)[1] + 40) < 1, `the box on the held one sank to ${air.pose(24, 1)[1]}`);
  const lands = air.contacts.filter((c) => c.wall === 0);
  assert.equal(lands.length, 1, `the pair landed ${lands.length} times`);
  assert.ok(lands[0].frame > 25 && lands[0].speed > 400, `the landing at frame ${lands[0].frame} closed at ${lands[0].speed}`);

  // Held on the floor with a box resting on it: let go, neither has anything to
  // land on, so the log stays empty and neither sinks. planck rests a body
  // about 1 unit off what it rests on, so each may rise by that much.
  const floor = simulate({ frames: 48, hz: 24, gravity: [0, G], walls: [FLOOR], bodies: [{ x: 0, y: 180, width: 40, height: 40, hold: 1 }, { x: 0, y: 140, width: 40, height: 40 }] });
  assert.deepEqual(floor.contacts.map((c) => [c.frame, c.body, c.other, c.wall, c.speed]), [], 'letting a resting body go logged impacts');
  for (const [k, y] of [[0, 180], [1, 140]]) {
    const end = floor.pose(47, k)[1];
    assert.ok(end <= y + 0.1 && end > y - 2.5, `box ${k} ends at y ${end}, not just above ${y}`);
  }
});

test('simulate: a stack of boxes left alone stands', () => {
  const bodies = [];
  for (let k = 0; k < 5; k++) bodies.push({ x: 0, y: 200 - 40 * (k + 0.5), width: 40, height: 40 });
  const r = simulate({ frames: 240, hz: 24, gravity: [0, G], bodies, walls: [FLOOR], friction: 0.5, restitution: 0.1 });
  const [x, , a] = r.pose(239, 4);
  assert.ok(Math.abs(a) < 1e-3 && Math.abs(x) < 0.5, `the top box ends at x ${x}, turned ${a}`);
  assert.equal(r.contacts.length, 0, 'a stack at rest logged impacts');
});

test('simulate: a fast body does not pass through a fixed wall, at any substeps', () => {
  for (const speed of [2000, 30000]) {
    for (const substeps of [1, 16]) {
      const r = simulate({ frames: 24, hz: 24, substeps, bodies: [{ x: 0, y: 0, width: 20, height: 20, vy: speed, angle: 0.3 }], walls: [{ from: [-500, 100], to: [500, 100] }] });
      let deepest = -Infinity;
      for (let f = 0; f < r.frames; f++) deepest = Math.max(deepest, r.pose(f, 0)[1]);
      assert.ok(deepest < 100, `a box at ${speed} units a second with ${substeps} substeps reached y ${deepest}, past the wall at 100`);
    }
  }
  // Nothing slows it on the way: planck's own cap is twice its size a step.
  const free = simulate({ frames: 2, hz: 24, substeps: 1, bodies: [{ x: 0, y: 0, width: 20, height: 20, vy: 2000, spin: 30 }] });
  assert.deepEqual(free.motion(1, 0), [0, 2000, 30]);
});

test('simulate: a fast body does not pass through another body', () => {
  for (const [vx, substeps] of [[2000, 1], [5000, 4], [30000, 16]]) {
    const r = simulate({ frames: 24, hz: 24, substeps, bodies: [{ x: 0, y: 0, width: 20, height: 20, vx }, { x: 400, y: 0, width: 20, height: 200, mass: 100 }] });
    let furthest = -Infinity;
    for (let f = 0; f < r.frames; f++) furthest = Math.max(furthest, r.pose(f, 0)[0] - r.pose(f, 1)[0]);
    assert.ok(furthest < 0, `a box at ${vx} units a second with ${substeps} substeps passed ${furthest} units beyond the body it met`);
    assert.equal(r.contacts.filter((c) => c.other === 1).length, 1, `a box at ${vx} with ${substeps} substeps logged no contact with the body`);
  }
});

test('simulate: a slow drift and a slow spin keep going with no drag', () => {
  // planck would put a body moving below its own tolerances to sleep and stop it.
  const r = simulate({ frames: 240, hz: 24, bodies: [{ x: 0, y: 0, width: 200, height: 200, spin: 0.02 }, { x: 1000, y: 0, width: 200, height: 200, vx: 1 }, { x: 0, y: 1000, width: 60, height: 60, spin: 0.03 }] });
  const t = 239 / 24;
  assert.ok(Math.abs(r.pose(239, 0)[2] - 0.02 * t) < 1e-6, `a spin of 0.02 turned ${r.pose(239, 0)[2]}, not ${0.02 * t}`);
  assert.ok(Math.abs(r.pose(239, 1)[0] - (1000 + t)) < 1e-6, `a drift of 1 reached ${r.pose(239, 1)[0]}, not ${1000 + t}`);
  assert.ok(Math.abs(r.motion(239, 2)[2] - 0.03) < 1e-9, `a spin of 0.03 ends at ${r.motion(239, 2)[2]}`);
});

test('simulate: a contact between two bodies names the first frame whose poses touch', () => {
  // Closing at 200 the two boxes meet between frames 19 and 20; at 80 they
  // meet exactly on frame 48. Each body's step is swept against the other, so
  // they meet within the step and part again, at any substeps.
  for (const [speed, substeps, touch] of [[200, 1, 20], [80, 1, 48], [200, 2, 20], [80, 2, 48], [200, 16, 20]]) {
    const r = simulate({ frames: 60, hz: 24, substeps, bodies: [{ x: -100, y: 0, width: 40, height: 40, vx: speed }, { x: 100, y: 0, width: 40, height: 40 }] });
    const gap = (f) => r.pose(f, 1)[0] - r.pose(f, 0)[0] - 40;
    assert.equal(r.contacts.length, 1);
    assert.ok(gap(touch - 1) > 1, `at ${speed} with ${substeps} substeps they touch before frame ${touch}`);
    assert.ok(r.motion(touch, 1)[0] > 0, `at ${speed} with ${substeps} substeps the second box has not moved by frame ${touch}`);
    const [c] = r.contacts;
    assert.equal(c.frame, touch, `at ${speed} with ${substeps} substeps the contact names frame ${c.frame}, not ${touch}`);
    assert.ok(c.seconds <= touch / 24 && c.seconds > (touch - 1) / 24, `the contact at ${c.seconds} s is not within frame ${touch}`);
  }
});

test('simulate refuses bodies it cannot solve, by name', () => {
  const base = { frames: 2, hz: 24, walls: [FLOOR] };
  const box = { x: 0, y: 0, width: 10, height: 10 };
  const refuse = (extra, pattern) => assert.throws(() => simulate({ ...base, ...extra }), pattern);
  refuse({ bodies: 3 }, /simulate: bodies must be a list of \{ x, y, width, height \} or \{ x, y, points \}/);
  refuse({ bodies: [] }, /simulate: particles must be a non-empty list/);
  refuse({ bodies: [{ x: 0, y: 0, height: 10 }] }, /simulate: body 0 width must be a finite number above 0, or give points, got undefined/);
  refuse({ bodies: [{ ...box, height: 0 }] }, /simulate: body 0 height must be a finite number above 0/);
  refuse({ bodies: [{ x: 0, y: 0, points: [[0, 0], [10, 0]] }] }, /simulate: body 0 points must be a list of 3 to 8 \[x, y\] corners/);
  refuse({ bodies: [{ x: 0, y: 0, points: [[0, 0], [10, 0], [2, 2], [0, 10]] }] }, /simulate: body 0 points must go round a convex shape/);
  const star = [0, 2, 4, 1, 3].map((j) => [30 * Math.cos((2 * Math.PI * j) / 5), 30 * Math.sin((2 * Math.PI * j) / 5)]);
  refuse({ bodies: [{ x: 0, y: 0, points: star }] }, /simulate: body 0 points must go round a convex shape once/);
  refuse({ bodies: [{ ...box, spin: 100 }], substeps: 1 }, /simulate: body 0 spin must be at most a quarter turn a substep, 37\.69\d* radians a second either way; raise substeps for more, got 100/);
  refuse({ bodies: [box, box, { x: 0, y: 0, points: [[0, 0], [0.01, 0], [0, 0.01]] }] }, /simulate: body 2 points 0 and 1 must be at least 0\.025 apart, 1\/400 of the bodies' median size, or planck merges them/);
  refuse({ bodies: [{ x: 0, y: 0, points: [[0, 0], [10, 0], [0, 10]], width: 5 }] },/simulate: body 0 takes width and height, or points, not both/);
  refuse({ bodies: [{ ...box, mass: 0 }] }, /simulate: body 0 mass must be a finite number above 0, got 0/);
  refuse({ bodies: [{ ...box, hold: 1, spin: 2 }] }, /simulate: body 0 is held, so it starts at rest/);
  refuse({ bodies: [{ ...box, path: () => [0, 0] }] }, /simulate: body 0 takes no path/);
  refuse({ bodies: [box], walls: [{ from: (s) => [s, 0], to: [10, 0] }] }, /simulate: wall 0 moves, and bodies meet only walls that stand still/);
  const r = simulate({ ...base, bodies: [box] });
  assert.throws(() => r.pose(2, 0), /simulate: pose needs a whole frame from 0 to 1, got 2/);
  assert.throws(() => r.motion(0, 1), /simulate: motion needs a body index from 0 to 0, got 1/);
});

test('drape: no nail stands on or in a peg, at either end of spread, over 40 seeds', () => {
  // A nail lifted out of a peg once stopped on its rim, drawn sitting on it
  // (seed 7), and was lifted peg by peg, so it could land in the next one. Its
  // drawn disc, radius 5, must stand clear of every peg's bead zone.
  const piece = validate(EXAMPLES.drape);
  const bad = [];
  for (const spread of [0.5, 0.85, 1]) {
    for (let seed = 1; seed <= 40; seed++) {
      const s = solve(piece, seed, { spread }, { until: 'hang the cords' }).state;
      for (const c of s.cords) {
        for (const [x, y] of [c.a, c.b]) {
          for (const p of s.pegs) {
            if (Math.hypot(x - p.x, y - p.y) < p.radius + 4.5 + 1 + 5) bad.push(`spread ${spread} seed ${seed} nail (${x.toFixed(1)}, ${y.toFixed(1)})`);
          }
        }
      }
    }
  }
  assert.equal(bad.length, 0, `${bad.length} nails on or in a peg, first at ${bad[0]}`);
});

test('simulate: the runs the examples make, and the busy system, keep their pinned digests', () => {
  // A sha256 over positions, velocities and the contact log of each run. A
  // change to the solver that moves any of them must repin on purpose: run
  // this test, read the digest it names and paste it into PINS.
  const digest = (r) => createHash('sha256')
    .update(Buffer.from(r.xy.buffer, r.xy.byteOffset, r.xy.byteLength))
    .update(Buffer.from(r.vxy.buffer, r.vxy.byteOffset, r.vxy.byteLength))
    .update(JSON.stringify(r.contacts))
    .digest('hex');
  const example = (name, stage) => solve(validate(EXAMPLES[name]), undefined, undefined, { until: stage }).state.run;
  const PINS = {
    drape: '3f6090da38845eb3b89f8bb331cefd964209128090bceda6dd9c9aae2d560739',
    cascade: '9243cf2ab3df7572df8441d3b0b13792c8dc8db8106f5d96acac52e6f2c0602f',
    busy: '7e2a6144051374fd4bfa9d1e7ac3edfed1252d4aff2d052d6b1a0de3a8a791b6',
  };
  // Testing every pair must give the busy system's bytes, so it shares its pin.
  const runs = [
    ['drape', 'drape', () => example('drape', 'drop the cords')],
    ['cascade', 'cascade', () => example('cascade', 'drop them')],
    ['busy', 'busy', () => simulate(busy())],
    ['busy, testing every pair,', 'busy', () => simulate(busy(), { everyPair: true })],
  ];
  const moved = [];
  for (const [label, pin, run] of runs) {
    const got = digest(run());
    if (got !== PINS[pin]) moved.push(`the ${label} run moved: its digest is now ${got}`);
  }
  assert.deepEqual(moved, [], `${moved.join('; ')}. If the change is meant, set each named run's entry in PINS in tests/sim.test.js to its new digest`);
});

// A medium on a grid: baked once, the same every time, and stable at any push.

test('fluid carries what its sources add, stays finite at any push, keeps its velocity free of sinks and gives isolines their samples', () => {
  const { fluid } = require('../core/sim.js');
  const { isolines } = require('../core/field.js');
  const base = { cols: 32, rows: 24, frames: 48, hz: 24 };
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const top = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  // Where the density sits, as its mean row and column.
  const centre = (a) => { let m = 0, x = 0, y = 0; a.forEach((d, k) => { m += d; x += d * (k % 33); y += d * Math.floor(k / 33); }); return [x / m, y / m]; };

  const still = fluid(base);
  assert.deepEqual([still.cols, still.rows, still.frames], [32, 24, 48]);
  assert.equal(still.density(47).length, 33 * 25, 'one sample per corner');
  assert.equal(top(still.density(47)) + top(still.velocity(47)[0]) + top(still.velocity(47)[1]), 0, 'nothing added, nothing moves');

  // A puff pushed to the right drifts right; the same spec gives the same run.
  const puff = { ...base, sources: [{ at: [0.25, 0.5], radius: 3, density: 20, push: [60, 0], to: 0.5 }] };
  const run = fluid(puff);
  assert.ok(sum(run.density(0)) > 0, 'the first frame already holds the first breath');
  const [x12] = centre(run.density(12)), [x47, y47] = centre(run.density(47));
  assert.ok(x47 > x12 + 2, `the puff drifts right: column ${x12} at frame 12, ${x47} at frame 47`);
  assert.ok(Math.abs(y47 - 12) < 1.5, 'and stays level');
  assert.ok(run.density(47).every((d) => d >= 0 && Number.isFinite(d)));
  const digest = (r) => createHash('sha256').update(Buffer.from(r.density(47).buffer)).update(Buffer.from(r.velocity(47)[0].buffer)).digest('hex');
  assert.equal(digest(fluid(puff)), digest(run), 'one spec gives one run');
  assert.ok(Math.abs(run.sample(47, x47 / 32, y47 / 24) - run.density(47)[Math.round(x47) + 33 * Math.round(y47)]) < 0.5 * top(run.density(47)), 'sample reads between corners');
  assert.equal(run.sample(47, 0, 0), run.density(47)[0]);
  assert.equal(run.sample(47, 1, 1), run.density(47)[33 * 25 - 1]);

  // The velocity piles up nowhere: its divergence is small beside its speed.
  const [u, v] = run.velocity(30);
  let div = 0, speed = 0;
  for (let j = 2; j < 23; j++) for (let i = 2; i < 31; i++) { const k = i + 33 * j; div += Math.abs(0.5 * (u[k + 1] - u[k - 1] + v[k + 33] - v[k - 33])); speed += Math.hypot(u[k], v[k]); }
  assert.ok(div < 0.05 * speed, `divergence ${div} against speed ${speed}`);

  // A push no explicit step would survive: a thousand cells a frame. It stays finite and bounded.
  const wild = fluid({ ...base, sources: [{ at: [0.5, 0.5], radius: 4, density: 50, push: [24000, -24000] }] });
  for (const f of [0, 20, 47]) {
    assert.ok(wild.density(f).every(Number.isFinite) && wild.velocity(f)[0].every(Number.isFinite), `frame ${f} is finite`);
    assert.ok(top(wild.density(f)) <= 50 * (f + 1) / 24 + 1e-6, 'no cell holds more than was added');
  }

  // Buoyancy lifts it, fade empties it, diffusion spreads it.
  const plume = fluid({ ...base, buoyancy: 40, sources: [{ at: [0.5, 0.8], radius: 2.5, density: 30, to: 0.25 }] });
  assert.ok(centre(plume.density(47))[1] < centre(plume.density(8))[1] - 2, 'a dense puff rises towards -y');
  const fading = fluid({ ...puff, fade: 4 });
  assert.ok(sum(fading.density(47)) < 0.01 * sum(run.density(47)), 'fade empties the grid');
  const peak = (r) => top(r.density(47)) / sum(r.density(47));
  assert.ok(peak(fluid({ ...puff, diffusion: 3 })) < 0.6 * peak(run), 'diffusion flattens the puff');
  // A source that moves, as a function of the second.
  const moving = fluid({ ...base, sources: (t) => [{ at: [0.2 + 0.3 * t, 0.5], density: 10 }] });
  assert.ok(centre(moving.density(47))[0] > centre(moving.density(5))[0] + 3);

  // Its samples are the grid isolines take.
  const lines = isolines(run.density(47), 32, 24, top(run.density(47)) / 2);
  assert.ok(lines.paths.length >= 1 && lines.paths[0].length > 4, 'a contour at half the peak');

  for (const [spec, message] of [
    [null, /^RangeError: fluid: the spec must be an object of its keys, got null$/],
    [{ ...base, cols: 2 }, /^RangeError: fluid: cols must be a whole number from 4 to 512, got 2$/],
    [{ ...base, frames: 0 }, /^RangeError: fluid: frames must be a whole number, 1 or more, got 0$/],
    [{ ...base, hz: 0 }, /^RangeError: fluid: hz must be a frame rate above 0, got 0$/],
    [{ ...base, viscosity: -1 }, /^RangeError: fluid: viscosity must be 0 or more, got -1$/],
    [{ ...base, iterations: 0 }, /^RangeError: fluid: iterations must be a whole number from 1 to 200, got 0$/],
    [{ ...base, sources: 3 }, /^RangeError: fluid: sources must be a list of sources, or a function of the second and the frame that returns one$/],
    [{ ...base, sources: [{ at: [0.5] }] }, /^RangeError: fluid: source 0 needs at and push as finite \[x, y\] pairs$/],
    [{ ...base, sources: [{ at: [0.5, 0.5], radius: 0 }] }, /^RangeError: fluid: source 0 radius must be cells above 0, got 0$/],
    [{ ...base, sources: () => 5 }, /^RangeError: fluid: sources at 0 s must return a list, got 5$/],
    [{ cols: 512, rows: 512, frames: 400, hz: 24 }, /^RangeError: fluid: 400 frames of 513 by 513 samples are more than the 67108864 a run keeps; use a coarser grid$/],
  ]) assert.throws(() => fluid(spec), message);
  assert.throws(() => run.density(48), /^RangeError: fluid: frame must be a whole number from 0 to 47, got 48$/);
});

test('simulate takes a force that varies in time and place, and without one the solve is as before', () => {
  const base = { frames: 31, hz: 30, particles: [{ x: 0, y: 0 }, { x: 10, y: 0, mass: 2 }] };
  const still = simulate(base);
  assert.deepEqual(simulate({ ...base, force: () => [0, 0] }).xy, still.xy, 'a force of nothing changes nothing');
  // A steady push of 6 to the right: the lighter particle goes twice as far.
  const pushed = simulate({ ...base, force: () => [6, 0] });
  const a = pushed.at(30, 0)[0], b = pushed.at(30, 1)[0] - 10;
  assert.ok(a > 2.5 && Math.abs(a / b - 2) < 1e-6, `the push moved them ${a} and ${b}`);
  assert.equal(pushed.at(30, 0)[1], 0);
  // A wind that blows only after half a second, and only left of x = 5.
  const gust = simulate({ ...base, force: (seconds, x) => (seconds >= 0.5 && x < 5 ? [0, -4] : [0, 0]) });
  assert.equal(gust.at(14, 0)[1], 0, 'before the gust nothing moves');
  assert.ok(gust.at(30, 0)[1] < -0.3, 'after it the particle in the wind rises');
  assert.equal(gust.at(30, 1)[1], 0, 'the one outside the wind stays');
  assert.throws(() => simulate({ ...base, force: 3 }), /simulate: force must be a function \(seconds, x, y\) returning \[fx, fy\]/);
  assert.throws(() => simulate({ ...base, force: () => [1] }), /simulate: force must return a finite \[fx, fy\]/);
});

test('simulate breaks a link at its second or past its stretch, and reports when', () => {
  const hung = { frames: 61, hz: 30, gravity: [0, 10], particles: [{ x: 0, y: 0, hold: Infinity }, { x: 0, y: 5 }], links: [[0, 1]] };
  const held = simulate(hung);
  assert.ok(Math.abs(held.at(60, 1)[1] - 5) < 0.2, 'the link holds the weight');
  assert.deepEqual([...held.broken], []);
  const cut = simulate({ ...hung, breaks: [{ link: 0, at: 1 }] });
  assert.ok(Math.abs(cut.at(29, 1)[1] - 5) < 0.2, 'it hangs until the second it is cut');
  assert.ok(cut.at(60, 1)[1] > 9, `then it falls, to ${cut.at(60, 1)[1]}`);
  assert.equal(cut.broken.length, 1);
  assert.equal(cut.broken[0].link, 0);
  assert.equal(cut.broken[0].frame, 30);
  assert.ok(Math.abs(cut.broken[0].seconds - 1) < 0.01);
  // A weight thrown hard away from its anchor: the link gives way once it is half again as long.
  const thrown = { frames: 31, hz: 30, particles: [{ x: 0, y: 0, hold: Infinity }, { x: 0, y: 5, vy: 2000 }], links: [[0, 1]] };
  const snapped = simulate({ ...thrown, breaks: [{ link: 0, stretch: 1.5 }] });
  assert.equal(snapped.broken.length, 1, 'the stretched link snaps');
  assert.equal(snapped.broken[0].frame, 1);
  assert.ok(snapped.at(30, 1)[1] > 1000, 'and the weight flies free of it');
  const kept = simulate({ ...thrown, breaks: [{ link: 0, stretch: 50 }] });
  assert.equal(kept.broken.length, 0, 'a link never stretched that far holds');
  assert.ok(kept.at(30, 1)[1] < 50, 'and keeps the weight near');
  assert.throws(() => simulate({ ...hung, breaks: [{ link: 3, at: 1 }] }), /simulate: break 0 link must be a link index from 0 to 0/);
  assert.throws(() => simulate({ ...hung, breaks: [{ link: 0 }] }), /simulate: break 0 needs at, the second it gives way, or stretch/);
  assert.throws(() => simulate({ ...hung, breaks: [{ link: 0, stretch: 1 }] }), /simulate: break 0 stretch must be a share above 1/);
});
