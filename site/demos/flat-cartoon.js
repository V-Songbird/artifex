// The showcase site's demo of Flat cartoon: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/flat-cartoon.js. Site-only,
// never a starting point for a piece. One comic panel: the bird perched on a
// branch belts out a song, lettered as a sound effect beside its beak. The
// seed picks the bird's colours and ground, its eye, its tilt and its word.

'use strict';

const { rng } = require('../../core/rand.js');
const { chaikin } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { ellipse, caption } = require('../../skills/artifex/styles/kit.js');
const { INK, PAPER, PAINT, ink, flat, cel, blush, shine, sfx } = require('../../skills/artifex/styles/flat-cartoon.js');

const W = 1000; const H = 1000;
// One light for every cel shade and every heavy ink side: the upper left.
const LIGHT = -Math.PI * 3 / 4;

// The bird's colours, the ground they sit on and the sound effect's fill. The
// seed takes them in turn, so any three consecutive seeds show all three; the
// site's seed, 2026, gets the coral bird on a sky ground.
const LOOKS = [
  { ground: PAPER, body: PAINT.sky, wing: PAINT.blue, belly: PAINT.white, beak: PAINT.tan, word: PAINT.yellow },
  { ground: PAINT.sky, body: PAINT.coral, wing: PAINT.red, belly: PAINT.peach, beak: PAINT.yellow, word: PAINT.yellow },
  { ground: PAPER, body: PAINT.green, wing: '#4e9a5c', belly: '#fff3d6', beak: PAINT.red, word: PAINT.coral },
];
const WORDS = ['TWEET!', 'CHIRP!', 'TWEEE!'];

// The belly: the part of the bird's unit body below a line from the throat to
// the lower back, closed by a curve bowed up into the body, so it reads as a
// round pale front and gets its own cel shade along the body's lower edge.
const BELLY = (() => {
  const body = bird(0, 0, 1).body;
  const a = [0.75, -0.28]; const b = [-0.4, 0.31];
  const below = ([x, y]) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0;
  const n = body.length;
  const start = body.findIndex((p, i) => !below(p) && below(body[(i + 1) % n]));
  const run = [];
  for (let k = 1; k <= n && below(body[(start + k) % n]); k++) run.push(body[(start + k) % n]);
  const p = run[run.length - 1]; const q = run[0];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const c = [(p[0] + q[0]) / 2 - ((q[1] - p[1]) / len) * 0.22, (p[1] + q[1]) / 2 + ((q[0] - p[0]) / len) * 0.22];
  for (let k = 1; k < 12; k++) {
    const t = k / 12; const u = 1 - t;
    run.push([u * u * p[0] + 2 * u * t * c[0] + t * t * q[0], u * u * p[1] + 2 * u * t * c[1] + t * t * q[1]]);
  }
  return run;
})();

// A band round a dense open `spine`, `width(t)` wide at t from 0 to 1, as one
// clean polygon: one edge out, the other back, and a round cap at the end
// when `cap` is set, so a closed ink ring follows it with no spurs.
function band(spine, width, cap = false) {
  const n = spine.length;
  const side = spine.map((p, i) => {
    const a = spine[Math.max(0, i - 1)]; const b = spine[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const h = width(i / (n - 1)) / 2;
    return [(-(b[1] - a[1]) / l) * h, ((b[0] - a[0]) / l) * h];
  });
  const out = spine.map((p, i) => [p[0] + side[i][0], p[1] + side[i][1]]);
  if (cap) {
    const [x, y] = spine[n - 1]; const [u, v] = side[n - 1];
    for (let k = 1; k < 12; k++) { const a = -Math.PI * k / 12; out.push([x + u * Math.cos(a) - v * Math.sin(a), y + u * Math.sin(a) + v * Math.cos(a)]); }
  }
  for (let i = n - 1; i >= 0; i--) out.push([spine[i][0] - side[i][0], spine[i][1] - side[i][1]]);
  return out;
}

// A leaf from `a` to `b`, bent a little, pointed at both ends and `w` wide.
function leaf(a, b, w) {
  const c = [(a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.15, (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.15];
  const spine = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16; const u = 1 - t;
    spine.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return { pts: band(spine, (t) => w * Math.sin(Math.PI * t) ** 0.6), spine };
}

// One part, finished: its fill with its one cel shade, then its ink ring.
function part(g, R, name, pts, colour, depth, w) {
  cel(g, pts, colour, { light: LIGHT, depth });
  ink(g, R, name, pts, { w, closed: true, light: LIGHT });
}

function draw(g, s) {
  const R = rng(s.seed);
  const line = (s.params && s.params.line) ?? 9;
  const depth = (s.params && s.params.depth) ?? 0.14;
  const look = LOOKS[s.seed % LOOKS.length];
  const word = WORDS[Math.floor(R('look', 'word') * WORDS.length)];
  const happy = R('look', 'eye') < 0.4;
  const tilt = -0.06 + (R('pose', 'tilt') - 0.5) * 0.16;

  g.fillStyle = look.ground;
  g.fillRect(0, 0, W, H);

  // The branch, from the left edge, thinning to the right, with a twig.
  const twig = band(chaikin([[722, 750], [775, 696], [840, 670]], 3), (t) => 20 - 9 * t, true);
  part(g, R, 'twig', twig, PAINT.brown, depth, line * 0.8);
  const limb = band(chaikin([[-40, 790], [300, 774], [620, 758], [900, 730]], 3), (t) => 48 - 26 * t, true);
  part(g, R, 'limb', limb, PAINT.brown, depth, line);
  for (const [i, [a, b, w]] of [[[838, 670], [926, 620], 42], [[792, 690], [728, 628], 38], [[846, 674], [906, 730], 32], [[160, 782], [84, 850], 38]].entries()) {
    const l = leaf(a, b, w);
    part(g, R, 'leaf' + i, l.pts, PAINT.green, depth, line * 0.7);
    ink(g, R, 'vein' + i, l.spine.slice(3, 12), { w: line * 0.4 });
  }

  const b = bird(480, 565, 265, tilt);

  // Legs and toes gripping the branch, behind the body.
  for (const [i, [top, foot]] of b.legs.entries()) {
    const toe = [foot[0], 752 - 4 * i];
    ink(g, R, 'leg' + i, [top, toe], { w: line * 0.75, taper: 0.8 });
    ink(g, R, 'toe' + i, [[toe[0] - 22, toe[1] + 2], [toe[0], toe[1] - 6], [toe[0] + 24, toe[1] + 6]], { w: line * 0.7, taper: 0.5 });
  }

  part(g, R, 'tail', b.tail, look.wing, depth, line);
  cel(g, b.body, look.body, { light: LIGHT, depth });
  cel(g, b.at(BELLY), look.belly, { light: LIGHT, depth });
  const head = b.at([[0.24, -0.5], [0.34, -0.62], [0.5, -0.64]]);
  shine(g, head[0], head[1], head[2], { w: line * 1.1 });
  blush(g, b.cheek[0] + 4, b.cheek[1] + 8, 0.1 * b.s, 0.06 * b.s, { lines: 3, rot: tilt });
  ink(g, R, 'body', b.body, { w: line, closed: true, light: LIGHT });
  part(g, R, 'wing', b.wing, look.wing, depth, line * 0.85);
  ink(g, R, 'feather0', b.at([[-0.5, -0.2], [-0.3, -0.12], [-0.1, -0.07]]), { w: line * 0.5 });
  ink(g, R, 'feather1', b.at([[-0.42, -0.25], [-0.26, -0.21], [-0.12, -0.19]]), { w: line * 0.45 });
  part(g, R, 'beak', b.beak, look.beak, depth, line * 0.75);

  // The eye: an ink dot with a glint, or, singing, a shut arc.
  if (happy) {
    const arc = [];
    for (let k = 0; k <= 8; k++) { const a = Math.PI * (1.1 + 0.8 * k / 8); arc.push(b.at([[0.5 + Math.cos(a) * 0.075, -0.42 + Math.sin(a) * 0.075]])[0]); }
    ink(g, R, 'eye', arc, { w: line * 1.1, taper: 0.4 });
  } else {
    flat(g, ellipse(b.eye[0], b.eye[1], 0.06 * b.s, 0.072 * b.s, 32, tilt), INK);
    flat(g, ellipse(b.eye[0] + 0.02 * b.s, b.eye[1] - 0.025 * b.s, 0.02 * b.s, 0.02 * b.s, 16), PAINT.white);
  }

  // The song: three motion lines off the beak, and the word, aimed away from it.
  const tip = b.at([[1.04, -0.36]])[0];
  for (let k = 0; k < 3; k++) {
    const a = -0.6 + k * 0.5;
    ink(g, R, 'song' + k, [[tip[0] + Math.cos(a) * 34, tip[1] + Math.sin(a) * 34], [tip[0] + Math.cos(a) * 92, tip[1] + Math.sin(a) * 92]], { w: line * 0.8 });
  }
  sfx(g, R, 'word', word, 520, 250, 84, { fill: look.word, rot: -0.16 });

  caption(g, 'FLAT CARTOON', font, INK);
}

module.exports = {
  name: 'flat-cartoon',
  size: { w: 1000, h: 1000 },
  seed: 2026,
  params: {
    line: { min: 3, max: 18, value: 9, meaning: 'Ink line width: thin and quiet at 3, a bold, swelling brush line at 18.' },
    depth: { min: 0.04, max: 0.32, value: 0.14, meaning: 'Cel shade depth: a thin glossy crescent at 0.04, a wide hard side light at 0.32.' },
  },
  draw,
};
