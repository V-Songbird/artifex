// cues -- authored motion. Three cut-paper forms on a floor follow a written
// script: eased moves, a blink, and scene changes that pass through the picture
// part by part, each part heard as it turns.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other timeline in
// the set is a consequence: a pen travelling, a reading advancing, a system
// settling. Here nothing is simulated. Every move, every bump and every scene
// change is a cue someone wrote, resolved once onto whole frames in the build,
// and the picture and the soundtrack both read that one table. A cue that lands
// a frame late is a different piece, and the tests can say which frame.
//
// SCENE CHANGES BLEND, PART BY PART. At a change the forms stay where they are,
// and the ground, the floor and then each form turn to the next palette in
// order, over a short overlap. The change is anchored at the shot boundary: the
// boundary frame is the first that shows it, and each part's note sounds on the
// frame that first shows that part turning. `blend` at 0 is a hard cut, every
// part on the boundary frame at once, heard as one chord. A part turns along
// OKLCh, so a change between complementary palettes keeps its colour on the way
// instead of passing through grey.
//
// ONE FINISH OVER THE FILM. The cut edges carry the paper's material; the
// finish carries the film's: grain that boils, a little gate weave and flicker,
// a vignette, and one print grade that holds the four palettes in one stock.
// It is drawn on raster frames only, so the SVG keeps the bare cut forms.

'use strict';

const { rng, noise2 } = require('../core/rand.js');
const { lerp } = require('../core/num.js');
const { mix, mixOklch } = require('../core/colour.js');
const { fill } = require('../core/path.js');
const { span, ease, tween, shots } = require('../core/time.js');
const { sumInto } = require('../core/sound.js');

const W = 960;
const H = 540;
const FLOOR = 420;           // where the floor starts; the forms stand on it

// The timeline. `draw` is handed the frame on its clock, but the build is not,
// so the cue table is resolved against these; `time` below says the same.
const DUR = 8;
const HZ = 24;
const FRAMES = Math.round(DUR * HZ);

// The scenes in playing order. `shots` puts each boundary on a whole frame.
const SCENES = [['arrive', 2], ['turn', 2], ['lift', 2], ['rest', 2]];

// Every part, in the order it is drawn and the order a scene change reaches it.
const PARTS = ['ground', 'floor', 'disc', 'bar', 'dot'];
const FORMS = ['disc', 'bar', 'dot'];

// Four palettes on a ring. Each scene takes the next; the seed chooses where
// the piece enters the ring. Neighbours differ in every part, so each part's
// turn is visible on its first frame.
const PALETTES = [
  { ground: '#ece4d3', floor: '#d8ccb4', disc: '#c8553d', bar: '#28474d', dot: '#e0a531' },
  { ground: '#1e2a33', floor: '#283945', disc: '#e9c46a', bar: '#e7dfd0', dot: '#e76f51' },
  { ground: '#dfe5dc', floor: '#c6d1c4', disc: '#3d5a80', bar: '#b56576', dot: '#262626' },
  { ground: '#3b2f45', floor: '#4a3b56', disc: '#f2a65a', bar: '#9fd8cb', dot: '#f6f1e9' },
];

// One chord per scene change, one note per part, rising in the order the parts
// turn: A minor seventh, F major seventh, then C major to rest on.
const CHORDS = [[45, 52, 60, 64, 67], [41, 48, 57, 60, 64], [48, 55, 64, 67, 72]];
const hertz = (note) => 440 * 2 ** ((note - 69) / 12);

module.exports = {
  name: 'cues',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: { duration: DUR, hz: HZ },
  seed: 3,
  params: {
    blend: { min: 0, max: 0.8, value: 0.5,
      meaning: 'seconds each scene change takes, from a hard cut at 0 to a slow turn part by part' },
  },
  // One print for the whole film: four palettes, one stock, one grade.
  finish: {
    grain: 0.35, weave: 1.2, flicker: 0.05, vignette: 0.35,
    grade: { black: '#1d1812', white: '#f4ecdc', tone: '#9c7a52', toning: 0.15 },
  },

  state: () => ({ forms: {}, shift: 0, enter: 0, cues: null }),

  build: [
    ['cut the forms', (s) => {
      const R = rng(s.seed);
      // Compositional: where the group stands, and how big each form is cut.
      s.shift = (R('stage', 'shift') - 0.5) * 80;
      s.enter = Math.floor(R('stage', 'palette') * PALETTES.length);
      const r = 78 + R('disc', 'size') * 20;
      const len = 250 + R('bar', 'length') * 70;
      const thick = 38 + R('bar', 'thickness') * 10;
      const d = 18 + R('dot', 'size') * 5;
      // Material: a cut edge wanders a little, smoothly, and each form wanders
      // in its own field. The outline is cut once; it does not boil.
      const edge = (name, amp) => (x, y) => amp * (2 * noise2(R, x, y, name) - 1);
      s.forms = {
        disc: { half: [r, r], outline: ring(r, 96, edge('cut disc', r * 0.016)) },
        bar: { half: [len / 2, thick / 2], outline: slab(len, thick, edge('cut bar', 1.3)) },
        dot: { half: [d, d], outline: ring(d, 40, edge('cut dot', d * 0.03)) },
      };
    }],

    ['write the cues', (s) => {
      // EVERY TIMED EVENT IS WRITTEN HERE, ONCE, IN FRAMES. `draw` and `sound`
      // read this table and nothing else, so they cannot disagree about when.
      const film = shots(SCENES, { hz: HZ, frames: FRAMES });
      const x = { disc: 290 + s.shift, bar: 575 + s.shift, dot: 790 + s.shift };
      const now = {
        disc: { x: -140, h: 0, turn: 0, squash: 1 },
        bar: { x: x.bar, h: 470, turn: 0, squash: 1 },
        dot: { x: W + 40, h: 0, turn: 0, squash: 1 },
      };
      const pose0 = JSON.parse(JSON.stringify(now));
      const moves = [];
      const bumps = [];
      // A move: one property from where it is to `to`, over whole frames of one
      // scene, at a named rate. A bump: out and back over a window, at rest at
      // both ends and at its middle frame.
      const move = (part, prop, scene, a, b, rate, to) => {
        moves.push({ part, prop, a: film[scene].start + a, b: film[scene].start + b, rate, from: now[part][prop], to });
        now[part][prop] = to;
      };
      const bump = (name, part, prop, scene, a, b, size) => {
        bumps.push({ name, part, prop, a: film[scene].start + a, b: film[scene].start + b, size });
      };
      const d = s.forms.dot.half[1];

      // arrive: the disc slides in and eases to a stop; the bar falls and lands
      // with a squash; the dot hops in.
      move('disc', 'x', 0, 4, 26, 'out', x.disc);
      move('bar', 'h', 0, 12, 30, 'in', 0);
      bump('land', 'bar', 'squash', 0, 31, 37, -0.3);
      move('dot', 'x', 0, 26, 42, 'out', x.dot);
      bump('hop', 'dot', 'h', 0, 26, 42, 70);
      // turn: the bar stands up, and the disc blinks.
      move('bar', 'turn', 1, 14, 32, 'inOut', Math.PI / 2);
      bump('blink', 'disc', 'squash', 1, 36, 44, -0.92);
      // lift: the dot hops over the standing bar while the disc rises, then rolls
      // in beneath it.
      const gap = (x.disc + x.bar) / 2 - 10;
      move('dot', 'x', 2, 12, 28, 'inOut', gap);
      bump('hop', 'dot', 'h', 2, 12, 28, 350);
      move('disc', 'h', 2, 14, 38, 'smooth', 120);
      move('dot', 'x', 2, 30, 44, 'inOut', x.disc);
      move('dot', 'turn', 2, 30, 44, 'inOut', (x.disc - gap) / d);
      // rest: the bar rocks down onto its other side; the disc settles on the dot.
      move('bar', 'turn', 3, 12, 32, 'back', Math.PI);
      move('disc', 'h', 3, 16, 36, 'out', 2 * d);

      // The scene changes. Each part turns over `len` frames; the parts start in
      // order, spread over the rest of the blend, the first on the boundary.
      const total = Math.round(s.params.blend * HZ);
      const len = Math.max(1, Math.round(total / 2));
      const spread = Math.max(0, total - len);
      const palette = (k) => PALETTES[(s.enter + k) % PALETTES.length];
      const changes = [];
      for (let k = 1; k < film.length; k++) {
        const B = film[k].start;
        PARTS.forEach((part, p) => {
          const onset = B + Math.round((p * spread) / (PARTS.length - 1));
          changes.push({ part, scene: k, onset, end: onset + len - 1,
            from: palette(k - 1)[part], to: palette(k)[part], note: CHORDS[k - 1][p] });
        });
      }
      s.cues = { parts: PARTS, shots: film, pose0, moves, bumps, changes, opening: palette(0) };
    }],
  ],

  draw(g, s, _t, clock) {
    const f = clock.frame;
    const ground = colourAt(s, 'ground', f);
    const floor = colourAt(s, 'floor', f);

    // Every part is drawn in its own save/restore, placed by one translate,
    // rotate and scale, and painted last in its own colour.
    part(g, 0, 0, 0, 1, () => { g.fillStyle = ground; g.fillRect(0, 0, W, H); });
    part(g, 0, 0, 0, 1, () => { g.fillStyle = floor; g.fillRect(0, FLOOR, W, H - FLOOR); });

    // The light is overhead. A shadow narrows and fades as its form rises, so
    // height reads without a horizon.
    const shade = mix(floor, '#000000', 0.45);
    for (const name of FORMS) {
      const p = poseAt(s, name, f);
      const k = Math.exp(-p.h / 140);
      g.globalAlpha = 0.06 + 0.24 * k;
      g.fillStyle = shade;
      g.beginPath();
      g.ellipse(p.x, FLOOR + 4, reach(s, name, p.turn) * (0.6 + 0.4 * k) + 4, 3 + 3 * k, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // Each form is a cut sheet lifted a little off the ground: a darker copy
    // offset down and right first, then the form.
    const lift = mix(ground, '#000000', 0.5);
    for (const name of FORMS) {
      const p = poseAt(s, name, f);
      const outline = s.forms[name].outline;
      // The offset is the same on screen however the form is turned or squashed.
      const c = Math.cos(p.turn);
      const sn = Math.sin(p.turn);
      part(g, p.x, p.y, p.turn, p.squash, () => {
        g.save();
        g.translate(c * 2.5 + sn * 3.5, (c * 3.5 - sn * 2.5) / p.squash);
        g.globalAlpha = 0.3;
        g.fillStyle = lift;
        fill(g, outline);
        g.restore();
        g.globalAlpha = 1;
        g.fillStyle = colourAt(s, name, f);
        fill(g, outline);
      });
    }
  },

  // Heard on the changes. Each part's turn is one note, started on the frame
  // that first shows it, read from the same cue table, panned where the part
  // stands, and rung out long enough to carry the change.
  sound(ctx, s, timeline) {
    const out = ctx.createGain();
    out.gain.value = 0.9;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 3600;
    out.connect(air);
    air.connect(ctx.destination);
    const notes = [];
    for (const c of s.cues.changes) {
      const at = c.onset / timeline.hz;
      const decay = 2.4 - (c.note - 40) * 0.035;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.15, at + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0005, at + decay);
      const place = ctx.createStereoPanner();
      place.pan.value = FORMS.includes(c.part) ? (poseAt(s, c.part, c.onset).x / W) * 1.2 - 0.6 : 0;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hertz(c.note);
      osc.connect(env);
      env.connect(place);
      notes.push(place);
      osc.start(at);
      osc.stop(at + decay + 0.05);
    }
    // Two at a time, so every render adds the notes up in the same order.
    sumInto(ctx, notes, out);
  },
};

/** Draw one part inside its own save/restore at its pose. */
function part(g, x, y, turn, squash, paint) {
  g.save();
  g.translate(x, y);
  g.rotate(turn);
  g.scale(1, squash);
  paint();
  g.restore();
}

/** Where a form is on a frame: its moves, then its bumps, read from the cues. */
function poseAt(s, name, frame) {
  const v = { ...s.cues.pose0[name] };
  for (const m of s.cues.moves) {
    if (m.part === name && frame >= m.a) v[m.prop] = lerp(m.from, m.to, tween(m.a, m.b, ease[m.rate])(frame));
  }
  for (const b of s.cues.bumps) {
    if (b.part === name) v[b.prop] += b.size * ease.bump(span(b.a, b.b, frame));
  }
  // A form stands on the floor: its lowest point is `h` above it. The bar
  // squashes onto its underside; the disc blinks about its middle.
  const low = name === 'bar' ? reach(s, name, v.turn + Math.PI / 2) * v.squash : s.forms[name].half[1];
  return { x: v.x, y: FLOOR - v.h - low, h: v.h, turn: v.turn, squash: v.squash };
}

/** How far a form reaches sideways from its middle at a turn. */
function reach(s, name, turn) {
  const [hw, hh] = s.forms[name].half;
  return Math.abs(Math.cos(turn)) * hw + Math.abs(Math.sin(turn)) * hh;
}

/** A part's colour on a frame: the opening palette, then each change it has reached. */
function colourAt(s, name, frame) {
  let c = s.cues.opening[name];
  for (const ch of s.cues.changes) {
    if (ch.part === name && frame >= ch.onset) c = mixOklch(ch.from, ch.to, ease.out(span(ch.onset - 1, ch.end, frame)));
  }
  return c;
}

/** A closed outline of `n` points around a circle, its edge moved by `edge`. */
function ring(r, n, edge) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const rr = r + edge(3 + c * 1.4, 5 + s * 1.4);
    pts.push([c * rr, s * rr]);
  }
  return pts;
}

/** A rounded slab `len` by `thick`, its edge moved along its normal by `edge`. */
function slab(len, thick, edge) {
  const c = thick * 0.45;
  const hx = len / 2 - c;
  const hy = thick / 2 - c;
  const pts = [];
  const corners = [[hx, hy, 0], [-hx, hy, Math.PI / 2], [-hx, -hy, Math.PI], [hx, -hy, Math.PI * 1.5]];
  corners.forEach(([cx, cy, a0], i) => {
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (k / 8) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * c, cy + Math.sin(a) * c, Math.cos(a), Math.sin(a)]);
    }
    // The straight run to the next corner, sampled so its edge can wander too.
    const [nx, ny, na] = corners[(i + 1) % 4];
    const [ex, ey] = [Math.cos(na), Math.sin(na)];
    const sx = cx + Math.cos(a0 + Math.PI / 2) * c;
    const sy = cy + Math.sin(a0 + Math.PI / 2) * c;
    const tx = nx + ex * c;
    const ty = ny + ey * c;
    const steps = Math.max(2, Math.round(Math.hypot(tx - sx, ty - sy) / 14));
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      pts.push([lerp(sx, tx, u), lerp(sy, ty, u), Math.cos(a0 + Math.PI / 2), Math.sin(a0 + Math.PI / 2)]);
    }
  });
  return pts.map(([px, py, nx, ny]) => {
    // Far apart in the field across the slab, so its two long edges wander
    // independently instead of pinching it at one place.
    const e = edge(px / 40, py / 8 + 11);
    return [px + nx * e, py + ny * e];
  });
}
