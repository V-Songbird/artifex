// refit -- a container whose contents refit to the box it is drawn in.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other example
// draws at one design box and leaves another aspect to scaling. This one
// declares `boxes`, reads the box it was solved for from `state.box`, and lays
// itself out again: the container takes the box less a fixed margin, and the
// things keep their size in design units, so a narrower box holds fewer of them
// rather than the same ones squeezed.
//
// THE THINGS ARE THE SAME THINGS AT EVERY BOX. Thing i has the same size, kind,
// colour and aim wherever it is drawn, addressed by its index; only where it
// comes to rest depends on the box. A box that holds 60 holds a different pile
// of the same first things as one that holds 200, so changing the box reads as
// the container changing, not as another picture.

'use strict';

const { rng } = require('../core/rand.js');
const { clamp } = require('../core/num.js');
const { span, ease } = require('../core/time.js');
const font = require('../core/stroke-font.js');

// Fixed in design units, so the container grows and shrinks with the box and
// the things do not.
const SIDE = 40;
const TOP = 100;
const BOTTOM = 76;
const RMIN = 12;
const RMAX = 44;
// Aims tried per thing across its slide, and how many things in a row may fail
// to fit before the container counts as full. A cap keeps a huge box finite.
const TRIES = 9;
const MISSES = 40;
const LIMIT = 4000;

const PAPER = '#efe9dd';
const INSIDE = '#e3dac8';
const INK = '#1f1d1a';
const PALETTE = ['#d9a441', '#c4553a', '#2f7f7a', '#2d4a7a', '#8aa37b', '#f4efe4'];

/** The container inside a box: its walls, rim and floor. */
function container(W, H) {
  return { x0: SIDE, x1: W - SIDE, rim: TOP, floor: H - BOTTOM };
}

module.exports = {
  name: 'refit',
  size: { w: 1280, h: 720 },
  boxes: { w: [240, 1920], h: [240, 1920] },
  seed: 5,
  outputs: ['raster', 'vector'],
  time: { duration: 8, hz: 30 },

  params: {
    grain: { min: 0.6, max: 1.6, value: 1, meaning: 'How big the things are; smaller things let more of them fit in the same box' },
    heap: { min: 20, max: 400, value: 140, meaning: 'How far each thing slides to a low spot: low heaps it up, high settles it level' },
  },

  build: [
    ['fill the container', (s) => {
      const R = rng(s.seed);
      const c = container(s.box.w, s.box.h);
      const { grain, heap } = s.params;
      // Placed things by column, so a drop looks only at its neighbours.
      const B = 2 * RMAX * grain;
      const columns = new Map();
      const near = (x, r) => {
        const out = [];
        for (let k = Math.floor((x - r - RMAX * grain) / B); k <= Math.floor((x + r + RMAX * grain) / B); k++) {
          const col = columns.get(k);
          if (col) out.push(...col);
        }
        return out;
      };
      // Where a thing of radius r dropped straight down at x first touches the
      // floor or a thing already there: the highest contact wins.
      const rest = (x, r) => {
        let y = c.floor - r;
        for (const o of near(x, r)) {
          const dx = Math.abs(x - o.x);
          if (dx < r + o.r) y = Math.min(y, o.y - Math.sqrt((r + o.r) ** 2 - dx * dx));
        }
        return y;
      };

      s.things = [];
      let misses = 0;
      for (let i = 0; misses < MISSES && i < LIMIT; i++) {
        const r = (RMIN + (RMAX - RMIN) * R('thing', 'size', i) ** 2) * grain;
        const room = c.x1 - c.x0 - 2 * r;
        if (room < 0) { misses++; continue; }
        // Each thing aims at the same fraction of the width at every box, then
        // slides up to `heap` either way to the lowest spot it can reach.
        const aim = c.x0 + r + R('thing', 'aim', i) * room;
        let best = null;
        for (let k = 0; k < TRIES; k++) {
          const x = clamp(aim + (k / (TRIES - 1) - 0.5) * 2 * heap, c.x0 + r, c.x1 - r);
          const y = rest(x, r);
          if (!best || y > best.y) best = { x, y };
        }
        // Then it rolls: downhill in ever smaller steps, until it sits in the
        // bottom of its gap, held by two things or a thing and a wall, rather
        // than balanced on a shoulder.
        for (let step = heap / (TRIES - 1); step > 0.25; step /= 2) {
          for (const x of [best.x - step, best.x + step]) {
            const at = clamp(x, c.x0 + r, c.x1 - r);
            const y = rest(at, r);
            if (y > best.y) best = { x: at, y };
          }
        }
        if (best.y - r < c.rim) { misses++; continue; }
        misses = 0;
        const thing = {
          i, x: best.x, y: best.y, r,
          kind: Math.floor(R('thing', 'kind', i) * 4),
          fill: PALETTE[Math.floor(R('thing', 'colour', i) * PALETTE.length)],
          turn: R('thing', 'turn', i) * Math.PI * 2,
          spin: (R('thing', 'spin', i) - 0.5) * 5,
        };
        s.things.push(thing);
        const k = Math.floor(best.x / B);
        if (!columns.has(k)) columns.set(k, []);
        columns.get(k).push(thing);
      }
      // They fall in the order they were placed, so nothing lands before the
      // thing it rests on, and the last lands with a fifth of the film to spare.
      const n = s.things.length;
      s.things.forEach((th, k) => { th.birth = n > 1 ? 0.7 * k / (n - 1) : 0; });
      s.container = c;
    }],
  ],

  draw(g, s, t) {
    const { w: W, h: H } = s.box;
    const c = s.container;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    g.fillStyle = INSIDE;
    g.fillRect(c.x0, c.rim, c.x1 - c.x0, c.floor - c.rim);

    let landed = 0;
    for (const th of s.things) {
      const u = span(th.birth, th.birth + 0.1, t);
      if (u <= 0) continue;
      if (u >= 1) landed++;
      // Falls from above the box, gathering speed, and turns to rest as it lands.
      const y = -th.r + (th.y + th.r) * ease.in(u);
      thing(g, th, th.x, y, th.turn + (1 - u) * th.spin);
    }

    // The walls over the contents, so a thing against one sits inside it.
    g.strokeStyle = INK;
    g.lineWidth = 8;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(c.x0 - 5, c.rim - 14);
    g.lineTo(c.x0 - 5, c.floor + 5);
    g.lineTo(c.x1 + 5, c.floor + 5);
    g.lineTo(c.x1 + 5, c.rim - 14);
    g.stroke();

    // How many have landed: at the last frame, how many this box holds.
    const label = `${landed} things`;
    g.lineWidth = 2.2;
    font.text(g, label, (W - font.width(label, 18)) / 2, c.floor + 30, 18);
  },
};

/** One thing inside its circle of radius r: a disc, a ring, a square or a pill. */
function thing(g, th, x, y, turn) {
  const r = th.r;
  g.save();
  g.translate(x, y);
  g.rotate(turn);
  g.fillStyle = th.fill;
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  if (th.kind === 0) {
    g.arc(0, 0, r - 1, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  } else if (th.kind === 1) {
    // A ring is a thick stroke with an ink edge either side.
    g.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    g.strokeStyle = INK;
    g.lineWidth = r * 0.52;
    g.stroke();
    g.strokeStyle = th.fill;
    g.lineWidth = r * 0.52 - 4;
    g.stroke();
  } else if (th.kind === 2) {
    const a = r * 0.7;
    g.roundRect(-a, -a, 2 * a, 2 * a, r * 0.18);
    g.fill();
    g.stroke();
  } else {
    const h = r * 0.48;
    g.moveTo(-r + h, -h);
    g.lineTo(r - h, -h);
    g.arc(r - h, 0, h, -Math.PI / 2, Math.PI / 2);
    g.lineTo(-r + h, h);
    g.arc(-r + h, 0, h, Math.PI / 2, Math.PI * 1.5);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.restore();
}
