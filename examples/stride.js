// stride -- a hinged figure walks: its legs, hips and arms are posed by key
// tracks over the phase of one gait, its upper body hangs on springs behind
// them, and every footfall is heard on the frame its heel lands.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. `cues` writes each move
// as a cue with a start and an end; here nothing starts or ends. One `gait`
// counts the steps, its fraction is the phase of the step under way, and the
// legs, the hips and each arm's swing read their own `keys` track over that
// phase, with the upper body on springs behind them: the hips sink on the down
// and rise on the up, a heel lands toe up and rolls flat, a toe pushes off, the
// free foot swings through. The gait's `contacts` are also the score, so the
// picture and the footsteps cannot drift apart.
//
// THE FEET DO NOT SLIDE. A planted foot pivots about its heel as it lands and
// about its toe as it leaves, and neither point moves while it bears weight.
// The legs reach the feet, not the other way round: each knee is solved from
// the hip and the ankle. The walker stands tall; the hips drop below their
// keyed height only on a frame where a leg could not otherwise reach.
//
// THE UPPER BODY OVERLAPS ITS KEYS. The legs, the hips, the spine's lean and
// each arm's swing and reach are keyed; the chest, the head, the forearms and
// the hands each hang on a damped spring behind those keys, so they lag,
// carry on past and settle after every contact. The camera follows the
// walker at its mean pace, easing from step to step, and the ground, the
// hills and the sky move past at their own depths.
//
// THE LAND IS ALIVE BUT QUIET. Far off, a seeded flock crosses and a bird or
// two wheels on a rising current; trees stand on both ridges; the field holds
// grass, seed stalks, shrubs and tufts in flower of seeded heights and
// colours, all swaying in one gust that travels across it. Its cover runs
// over the ground's whole depth, graded by it: small, close and pale far
// off, larger, darker, fewer and more detailed near, the nearest cut by the
// frame's foot. All of it is smaller and slower than the walker.
//
// THE FIGURE IS HINGED ON PURPOSE. It is a jointed wooden figure, rigid parts
// turning at pins, which is what a machine, a puppet or a cut-out is. A
// person, an animal or a creature is painted as one outline over a hidden
// mannequin and bends along its length (core/deform.js): take the walk, the
// planted feet and the overlap from here, not the way the body is drawn.
//
// EVERY PLANT KEEPS ONE SIDE OF THE WALKER. A plant rooted above the sole's
// underside is painted behind the figure and hides under a foot; one rooted
// below it is painted in front, however tall, over the feet and shins, so no
// stem shows under a sole and vanishes into it. A foot that comes down over a
// plant presses it as low as its sole is, bending it forward; one under the
// ball stays pinned until the toe leaves, and the plant springs back and
// settles after the foot leaves; each first touch is a soft dry rustle, under
// the air.

'use strict';

const { rng, noise2 } = require('../core/rand.js');
const { lerp } = require('../core/num.js');
const { mix } = require('../core/colour.js');
const { span, ease, keys, gait } = require('../core/time.js');
const { voice, room, sumInto } = require('../core/sound.js');

const W = 960;
const H = 540;
// The timeline. The build is not handed the clock, so the poses are solved on
// these; `time` below says the same.
const DUR = 8;
const HZ = 24;
const FRAMES = Math.round(DUR * HZ);
const GY = 430;                // the ground line
const ANCHOR = 400;            // where the camera keeps the walk, across the frame

// The figure, in design units, side on and walking right.
const THIGH = 60;
const SHIN = 57;
const REACH = (THIGH + SHIN) * 0.998;   // a leg is never drawn quite straight
const TOE = 30;                // heel to toe along the sole
const BALL = 21;               // heel to the ball of the foot
const ANKLE = [8, -9];         // the ankle, from the heel, on a flat foot
const HIP_H = 123;             // the hips' height at the contact
const TORSO = 72;
const UPPER = 44;
const FORE = 40;
const HAND = 6;                // the wrist to the middle of the palm
const STEP = 66;               // how far one step carries the walker
// The sole is drawn 8 wide about the ground line, its rim 11: its underside
// sits SOLE below the line, the rim 1.5 lower. A plant rooted above the
// underside is painted behind the walker, one rooted below it in front; a
// foot can come down on any plant rooted within LOW of the line.
const SOLE = 4;
const LOW = 12;

// A foot's planted life, from its contact (0) to its toe leaving (TOE_OFF),
// counted in steps: the heel lands toe up and rolls flat by the down, holds
// flat through the passing, and the heel rises from the up, the toe planted.
const LAND = -0.32;            // radians, toe up as the heel lands
const OFF = 0.8;               // radians, heel up as the toe leaves
const TOE_OFF = 1.22;
const ROLL = keys([[0, LAND, ease.out], [0.14, 0], [0.6, 0, ease.in], [TOE_OFF, OFF]]);
// The free foot, over its swing from toe-off (0) to its next contact (1): it
// rises slowly, travels fast through the middle and goes down fast.
const SWING = keys([[0, 0, ease.in], [0.5, 0.52], [0.86, 0.96, ease.out], [1, 1]]);
const LIFT = keys([[0, 0, ease.out], [0.38, 16, ease.inOut], [0.84, 7, ease.in], [1, 0]]);
const TILT = keys([[0, OFF, ease.out], [0.5, 0.12, ease.inOut], [1, LAND]]);
// The hips over one step: they sink into the down, pass the middle at speed
// and rise to the up as the back foot pushes; they travel slower on the down.
const HIPS = keys([[0, 0, ease.out], [0.25, -1, ease.inOut], [0.75, 1, ease.in], [1, 0]]);
const PUSH = keys([[0, 0], [0.25, 0.22], [0.75, 0.8], [1, 1]]);
// An arm over two steps: back at 0 and forward at 1, widest a little after the
// opposite foot lands.
const ARM = keys([[0, -1, ease.inOut], [1, 1, ease.inOut], [2, -1]]);

// A footfall's levels, linear, at full velocity and before its distance: the
// knock's first partial, and the `level` of the heel's crack and of the toe's
// scrape, the RMS of each one's noise before its envelope (see `grit`). AWAY
// is how far the view stands from the walker, 0 near to 1 far, as the frame
// shows the whole figure, not its feet: each step is that much quieter, and
// the far foot 0.18 farther. The knock is no duller for it: the voice's
// distance lowpass sits at 7.7 kHz for the near foot and 5.3 kHz for the
// far, both far over its partials, under 310 Hz.
const THUMP = 0.02;
const CRACK = 0.048;
const SCRAPE = 0.015;
const AWAY = 0.35;
// A plant's rustle under a foot, the `level` of its noise at a full press of
// a plant 36 units tall: a detail under the air, 18 dB under a crack. Not
// louder: at 0.012 and at 0.0085 the AAC film's block holding a tall stalk's
// rustle (seed 5, 0.704 s) coded under replay's 25 dB floor, at 22.0 and
// 24.8 dB, and kept the render's band levels at 25.9 and 26.3 dB, under the
// 27 dB such a block kept before the rustles; at 0.006 it codes at 27.0 dB.
const RUSTLE = 0.006;

const SKY = ['#f3e2c4', '#f0d2b0', '#e9bfa0', '#e2ae97'];
const SUN = '#fbeed2';
const HILL_FAR = '#c9a7a4';
const HILL_MID = '#9c8f86';
const GROUND = '#a98763';
const INK = '#2e2622';
const WOOD = '#c98549';
const WOOD_FAR = '#8a5a38';
const JOINT = '#6f4a33';
// The plants: grass from green to straw, dry seed stalks, low shrubs, a few in flower.
const OLIVE = '#6f7550';
const STRAW = '#c9a964';
const RUST = '#94603f';
const SAGE = '#76806a';
const BLOOMS = ['#efe2c2', '#c4949c', '#dcb45c'];
const BIRD = mix(HILL_FAR, INK, 0.6);
// The air's level, linear: what every step and rustle is set against.
const AIR = 0.008;
// The two ridges: how fast each passes the camera, where its foot and crest
// sit, and its trees, flat and paler the farther off they stand.
const FAR = { name: 'far', depth: 0.15, base: 330, rise: 60, colour: HILL_FAR, scale: 0.0035,
  tree: 7, slope: 8, tones: [0.24, 0.3, 0.36].map((k) => mix(HILL_FAR, '#7d7a6a', k)) };
const MID = { name: 'mid', depth: 0.4, base: 380, rise: 42, colour: HILL_MID, scale: 0.006,
  tree: 12, slope: 22, tones: [0.34, 0.45, 0.56].map((k) => mix(HILL_MID, '#4c5640', k)) };

module.exports = {
  name: 'stride',
  size: { w: W, h: H },
  outputs: ['raster'],
  time: { duration: DUR, hz: HZ },
  seed: 4,
  params: {
    pace: { min: 10, max: 16, value: 13,
      meaning: 'frames each step takes: 10 hurries, 16 strolls; the camera keeps up' },
    weight: { min: 0, max: 1, value: 0.5,
      meaning: 'how heavily the figure walks: how far its hips sink and rise, and how hard each footfall lands' },
  },
  // One print over the whole walk: a boiling grain, a little weave, a warm grade.
  finish: {
    grain: 0.25, weave: 0.6, flicker: 0.015, vignette: 0.3,
    grade: { black: '#221a16', white: '#fbf2e2', tone: '#b0835a', toning: 0.12 },
  },

  state: () => ({ walk: null, plants: null, poses: null, falls: null, world: null, birds: null, brushes: null }),

  build: [
    ['count the steps', (s) => {
      const R = rng(s.seed);
      // Whole frames a step, so every contact lands on a frame. A walker is
      // never a metronome: a step may take a frame more or less than the pace.
      const pace = Math.round(s.params.pace);
      const lengths = [];
      for (let k = 0, sum = 0; sum < FRAMES + 2 * pace; k++) {
        const n = Math.max(8, pace + Math.round((R('step', 'time', k) - 0.5) * 2.4));
        lengths.push(n);
        sum += n;
      }
      s.walk = gait(0, lengths);
      // Where each heel lands, from the one planted before the first contact.
      const plants = [0];
      for (let k = 0; k <= lengths.length + 1; k++) plants.push(plants[k] + STEP * (1 + 0.08 * (R('step', 'length', k) - 0.5)));
      s.plants = plants;     // s.plants[k + 1] is contact k's heel
    }],

    ['pose every frame', (s) => {
      const bob = 2 + 9 * s.params.weight;
      s.poses = [];
      for (let f = 0; f < FRAMES; f++) s.poses.push(poseAt(s, f, bob));
      overlap(s.poses, s.walk.contacts[2]);
    }],

    ['hear the steps', (s) => {
      const R = rng(s.seed);
      const { contacts } = s.walk;
      s.falls = [];
      for (let k = 1; k < contacts.length - 1 && contacts[k] < FRAMES; k++) {
        const frame = contacts[k];
        const length = contacts[k + 1] - frame;
        s.falls.push({
          frame, foot: k % 2, length,
          // The toe of the foot behind leaves about a fifth into this step.
          push: Math.round(frame + 0.22 * length),
          heel: s.plants[k + 1],
          // Where the heel lands in the frame the camera shows, so a contact
          // strip's loupe crops the foot.
          x: s.plants[k + 1] - s.poses[frame].cam + ANCHOR, y: GY,
          // A longer step lands harder; the seed varies each a little more.
          weight: Math.min(1, 0.42 + 2.5 * ((s.plants[k + 1] - s.plants[k]) / STEP - 1) + 0.45 * R('fall', 'weight', k)),
        });
      }
    }],

    ['lay out the land', (s) => {
      const R = rng(s.seed);
      const from = s.poses[0].cam - ANCHOR - 200;
      const to = s.poses[FRAMES - 1].cam - ANCHOR + W + 200;
      // Each tuft one of four kinds, with its own height and colour.
      const tufts = [];
      for (let x = from, i = 0; x < to; i++) {
        const y = GY + 2 + 90 * R('tuft', 'depth', i) ** 2;
        const roll = R('tuft', 'kind', i);
        // In front of the walker a plant of any kind and height may rise over
        // its feet and shins: it is painted over them.
        const kind = roll < 0.6 ? 'grass' : roll < 0.76 ? 'stalk' : roll < 0.9 ? 'shrub' : 'bloom';
        tufts.push(tuft(R, 'tuft', i, x, y, kind));
        x += 7 + 16 * R('tuft', 'gap', i);
      }
      // The cover: the same four kinds spread evenly over the ground itself,
      // from past the band just in front of the walker to past the frame's
      // foot. Seen in perspective, the far ones pack into a texture and the
      // near ones stand larger, darker, fewer and in more detail, the nearest
      // rooted under the frame's edge and cut by it. `a` is the scale a plant
      // is drawn at, as in `plants`: there a patch of ground is drawn `a`
      // times as wide and `a` squared times as deep, so drawing 1 / a² evenly
      // spreads the plants evenly over the ground. The band within 20 of the
      // line is the tufts' own, with its stalks and shrubs over the feet.
      const far = (1 + 20 / 120) ** -2;
      const near = (1 + (H + 24 - GY) / 120) ** -2;
      for (let x = from, i = 0; x < to; i++) {
        const a = (far - R('cover', 'depth', i) * (far - near)) ** -0.5;
        const roll = R('cover', 'kind', i);
        tufts.push(tuft(R, 'cover', i, x, GY + 120 * (a - 1), roll < 0.64 ? 'grass' : roll < 0.82 ? 'stalk' : roll < 0.91 ? 'shrub' : 'bloom'));
        x += 2 + 6 * R('cover', 'gap', i);
      }
      tufts.sort((a, b) => a.y - b.y);
      // A foot over a low plant presses it as low as its sole's underside is
      // over the root, at once, and holds it there; the frame the foot
      // leaves, the plant is let go from that pose, at rest, on a damped
      // spring: it rises over a few frames, swings past upright and settles.
      // A planted foot pins a plant rooted from 2 units behind its ball to
      // its toe at its deepest press until the toe leaves, as the heel rises,
      // so it springs back from that press; the lifting foot then passes over
      // it. Each first touch is a brush, to be heard: its frame, plant, foot
      // and how hard it pressed, over the whole touch.
      s.brushes = [];
      for (const t of tufts) {
        if (t.y >= GY + LOW) continue;
        const free = t.h * (1 + (t.y - GY) / 120);
        const raw = new Float64Array(FRAMES);
        const by = new Int8Array(FRAMES);
        const pin = [];        // per foot: the contact pinning the plant, and how deep
        s.poses.forEach((q, f) => {
          q.feet.forEach((ft, j) => {
            let press = 0;
            if (t.x >= ft.heel[0] - 2 && t.x <= ft.toe[0] + 2) {
              const under = lerp(ft.heel[1], ft.toe[1], (t.x - ft.heel[0]) / (ft.toe[0] - ft.heel[0])) + SOLE;
              press = Math.min(1, 1 - (t.y - under) / free);
            }
            const pinned = pin[j] && pin[j][0] === ft.contact;
            if (pinned && !ft.planted) press = 0;
            else if (ft.planted && (pinned || (press > 0 && t.x >= s.plants[ft.contact + 1] + BALL - 2))) {
              press = Math.max(press, pinned ? pin[j][1] : 0);
              pin[j] = [ft.contact, press];
            }
            if (press > raw[f]) { raw[f] = press; by[f] = j; }
          });
        });
        t.press = release(raw, 2.4, 0.35);
        for (let f = 1; f < FRAMES; f++) {
          if (!(raw[f] > 0 && raw[f - 1] === 0)) continue;
          let peak = 0;
          for (let k = f; k < FRAMES && raw[k] > 0; k++) peak = Math.max(peak, raw[k]);
          // A sole that only grazes a tip, under a 0.15 press, makes no sound.
          if (peak >= 0.15) s.brushes.push({ frame: f, x: t.x, kind: t.kind, size: free, peak, foot: by[f] });
        }
      }
      s.brushes.sort((a, b) => a.frame - b.frame || a.x - b.x);
      // Trees on both ridges in clumps and alone, standing on the slope.
      const groves = {};
      for (const hill of [FAR, MID]) {
        const trees = [];
        const end = s.poses[FRAMES - 1].cam * hill.depth + W + 40;
        const sparse = 0.6 + 0.9 * R('grove', hill.name, 0);
        for (let u = s.poses[0].cam * hill.depth - 40 + 60 * R('grove', hill.name, 1), i = 0; u < end; i++) {
          const size = hill.tree * (0.6 + 0.7 * R('tree', `${hill.name} size`, i));
          trees.push({ u, size, kind: Math.floor(3 * R('tree', `${hill.name} kind`, i)), tone: Math.floor(3 * R('tree', `${hill.name} tone`, i)),
            y: crest(R, hill, u) + 1.5 + hill.slope * R('tree', `${hill.name} down`, i) ** 2 });
          u += R('tree', `${hill.name} clump`, i) < 0.4 ? 3 + size * R('tree', `${hill.name} gap`, i) : sparse * (40 + 200 * R('tree', `${hill.name} gap`, i));
        }
        groves[hill.name] = trees;
      }
      const motes = Array.from({ length: 26 }, (_, i) => ({
        x: R('mote', 'x', i) * (W + 60), y: 60 + R('mote', 'y', i) * (GY - 80),
        r: 1 + 1.6 * R('mote', 'size', i), drift: 0.6 + 1.2 * R('mote', 'drift', i), phase: R('mote', 'phase', i) * 6.283,
      }));
      const clouds = Array.from({ length: 5 }, (_, i) => ({
        x: R('cloud', 'x', i) * (W + 400), y: 60 + 150 * R('cloud', 'y', i),
        w: 120 + 140 * R('cloud', 'w', i), speed: 0.25 + 0.3 * R('cloud', 'speed', i),
      }));
      // The colours and depths the picture is drawn in, for a test to read instead of copying them.
      const colours = { wood: WOOD, woodFar: WOOD_FAR, sun: SUN, ink: INK, ground: GROUND, bird: BIRD,
        ridges: { far: { depth: FAR.depth, tones: FAR.tones }, mid: { depth: MID.depth, tones: MID.tones } } };
      s.world = { tufts, motes, clouds, groves, R, colours, air: AIR };
    }],

    ['set the birds flying', (s) => {
      const R = rng(s.seed);
      // A small flock crossing far off in a loose line that keeps re-forming.
      const n = 3 + Math.floor(4 * R('flock', 'count', 0));
      const dir = R('flock', 'dir', 0) < 0.5 ? -1 : 1;
      const speed = 30 + 25 * R('flock', 'speed', 0);
      const x0 = lerp(dir > 0 ? -90 : W + 90, W / 2, R('flock', 'x', 0));
      const y0 = 80 + 110 * R('flock', 'y', 0);
      const climb = 6 * (R('flock', 'climb', 0) - 0.5);
      s.birds = [];
      for (let j = 0; j < n; j++) {
        const rank = Math.ceil(j / 2);
        const side = j % 2 ? 1 : -1;
        const gap = 13 + 5 * R('flock', 'gap', j);
        const stagger = 5 + 3 * R('flock', 'stagger', j);
        s.birds.push(fly(s, R, 'flock', j, 6 + 2 * R('flock', 'span', j), 3.2 + 1.4 * R('flock', 'rate', j), 0.3, (t) => [
          x0 + dir * (speed * t - rank * gap) + 6 * (noise2(R, t * 0.35, j, 'flock x') - 0.5),
          y0 + climb * t + side * rank * stagger + 5 * (noise2(R, t * 0.3, j, 'flock y') - 0.5), 0,
        ]));
      }
      // One or two birds of prey wheeling on a rising current, mostly gliding,
      // banking into the turn.
      for (let j = 0; j < 1 + (R('wheel', 'count', 0) < 0.45 ? 1 : 0); j++) {
        const cx = W * (0.2 + 0.6 * R('wheel', 'x', j));
        const cy = 110 + 90 * R('wheel', 'y', j);
        const rx = 25 + 30 * R('wheel', 'reach', j);
        const ry = rx * (0.22 + 0.15 * R('wheel', 'tilt', j));
        const spin = (0.35 + 0.3 * R('wheel', 'speed', j)) * (R('wheel', 'way', j) < 0.5 ? -1 : 1);
        const a0 = 2 * Math.PI * R('wheel', 'from', j);
        const sink = 2 * (R('wheel', 'sink', j) - 0.5);
        s.birds.push(fly(s, R, 'wheel', j, 9 + 3 * R('wheel', 'span', j), 2.6, 0.62, (t) => [
          cx + rx * Math.cos(a0 + spin * t), cy + ry * Math.sin(a0 + spin * t) + sink * t, 0.3 * Math.sin(a0 + spin * t) * Math.sign(spin),
        ]));
      }
    }],
  ],

  draw(g, s, _t, clock) {
    const f = Math.min(FRAMES - 1, clock.frame);
    const pose = s.poses[f];
    const cam = pose.cam;
    const { R } = s.world;

    // The sky in fine bands, warming towards the ground, and a low sun on the left.
    const band = GY / 16;
    for (let i = 0; i < 16; i++) {
      const u = (i / 15) * (SKY.length - 1);
      const k = Math.min(SKY.length - 2, Math.floor(u));
      g.fillStyle = mix(SKY[k], SKY[k + 1], u - k);
      g.fillRect(0, i * band, W, band + 1);
    }
    const breathe = 0.5 + 0.5 * Math.sin(f / HZ * 1.3);
    for (let k = 3; k >= 1; k--) {
      g.globalAlpha = 0.14 + 0.04 * breathe;
      g.fillStyle = SUN;
      g.beginPath();
      g.arc(170, 285, 34 + k * (16 + 3 * breathe), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(170, 285, 34, 0, Math.PI * 2);
    g.fill();

    // Long thin clouds, drifting on their own and passing slowly behind.
    g.strokeStyle = mix(SUN, SKY[1], 0.4);
    for (const c of s.world.clouds) {
      const x = wrap(c.x - f * c.speed - cam * 0.04, -c.w - 40, W + 40);
      g.globalAlpha = 0.55;
      capsule(g, [x, c.y], [x + c.w, c.y], 9);
      capsule(g, [x + c.w * 0.25, c.y - 7], [x + c.w * 0.7, c.y - 7], 7);
    }
    g.globalAlpha = 1;

    // Two ridges, far and near, each moving past at its depth with its trees,
    // and birds far off above them.
    ridge(g, R, FAR, cam);
    grove(g, s, FAR, cam, f);
    g.save();
    g.strokeStyle = BIRD;
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    for (const bird of s.birds) wings(g, bird.path[f], bird.span);
    g.stroke();
    g.restore();
    ridge(g, R, MID, cam);
    grove(g, s, MID, cam, f);

    // The ground, and its furrows moving past at the walker's own speed.
    g.fillStyle = GROUND;
    g.fillRect(0, GY, W, H - GY);
    g.strokeStyle = mix(GROUND, INK, 0.12);
    g.lineWidth = 1.2;
    for (let row = 0; row < 7; row++) {
      const y = GY + 8 + row * row * 2.3;
      const gap = 90 + row * 30;
      const off = wrap(-(cam + row * 37) * (1 + row * 0.06), 0, gap);
      g.beginPath();
      for (let x = off - gap; x < W + gap; x += gap) {
        g.moveTo(x, y);
        g.lineTo(x + gap * 0.45, y);
      }
      g.stroke();
    }

    g.save();
    g.translate(ANCHOR - cam, 0);

    // A print under every heel that has landed, pressed in as the weight arrives.
    g.fillStyle = mix(GROUND, INK, 0.3);
    const { contacts } = s.walk;
    for (let k = 0; k < contacts.length && contacts[k] <= f; k++) {
      const x = s.plants[k + 1];
      if (x < cam - ANCHOR - 40 || x > cam - ANCHOR + W + 40) continue;
      g.globalAlpha = 0.45 * span(contacts[k] + 1, contacts[k] + 8, f);
      oval(g, x + 3, GY + 1.5, 5, 1.6);
      oval(g, x + BALL, GY + 1.5, 6, 1.8);
    }
    g.globalAlpha = 1;

    // The long shadow the low sun casts forward along the ground.
    g.save();
    g.transform(1, 0, -0.95, -0.22, 0.95 * GY, GY * 1.22);
    figure(g, pose, mix(GROUND, INK, 0.28));
    g.restore();

    // Dust kicked up where each heel lands.
    const dust = mix(GROUND, SUN, 0.45);
    for (const fall of s.falls) {
      const age = f - fall.frame;
      if (age < 0 || age >= 18) continue;
      const x = fall.heel;
      g.fillStyle = dust;
      for (let p = 0; p < 6; p++) {
        const dir = p < 3 ? -1 : 1;
        const sp = 0.6 + R('dust', 'speed', fall.frame * 8 + p);
        g.globalAlpha = 0.5 * fall.weight * (1 - age / 18);
        g.beginPath();
        g.arc(x + 4 + dir * (2 + age * sp * (1 + (p % 3) * 0.5)), GY - age * 0.45 * (1 + (p % 3)) - 1,
          1.5 + age * 0.3 * (0.6 + fall.weight), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // The plants rooted above the sole's underside behind the walker, those
    // rooted below it in front, each stirred by gusts and pressed by a foot.
    plants(g, s, f, cam, (t) => t.y < GY + SOLE);
    figure(g, pose, null);
    plants(g, s, f, cam, (t) => t.y >= GY + SOLE);
    g.restore();

    // Seeds adrift in the warm air, passing the camera.
    g.fillStyle = SUN;
    for (const m of s.world.motes) {
      const x = wrap(m.x - f * m.drift - cam * 0.6, -20, W + 20);
      const y = m.y + 10 * Math.sin(f / HZ * 1.7 + m.phase);
      g.globalAlpha = 0.35 + 0.3 * Math.sin(f / HZ * 2.3 + m.phase * 2) ** 2;
      g.beginPath();
      g.arc(x, y, m.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  },

  // A footfall on dry, hard ground: a short low knock of the weight arriving,
  // under a crack of grit as the heel lands, a few dry ticks as the weight
  // rolls to the ball, and a brief scrape as the other toe leaves the ground.
  // The steps are not what the scene is about: the frame shows the whole
  // figure in its land, so they sit in the mix as a detail, about the air's
  // level and a little far, present but never in the foreground, and dry.
  // Only the air goes to the room; a step sends nothing to it, so no echo
  // hangs after a footfall, and the knock is short, not a thud. Each foot has
  // its own ground, the far one darker and a little quieter, each fall its own
  // weight, grit and timing, and the walk swells and settles as a phrase.
  // Everything but the knock is broadband seeded noise, shaped and gone: no
  // sine grain, no chirp, nothing that rings or glides after the step, since
  // pitched pings at a step's tail are what drops, bubbles and squelches are
  // made of and read as wet ground whatever their rate.
  sound(ctx, s, timeline) {
    const R = rng(s.seed);
    const heavy = 0.7 + 0.5 * s.params.weight;
    const dry = ctx.createGain();
    const hall = room(ctx, R, 'room', { size: 1.4, bright: 4200, dark: 600 });
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.gain.setValueAtTime(0.9, Math.max(0, timeline.duration - 0.4));
    out.gain.linearRampToValueAtTime(0, timeline.duration);
    sumInto(ctx, [dry, hall], out);
    out.connect(ctx.destination);

    const voices = [];
    const sends = [];
    // A voice into the dry mix, and `send` of it, when given, into the room.
    const add = (v, send = 0) => {
      voices.push(v);
      if (send === 0) return;
      const g = ctx.createGain();
      g.gain.value = send;
      v.connect(g);
      sends.push(g);
    };
    // The air: a few soft gusts at seeded times, each a breath of dark noise
    // that swells and dies far off, no two alike and none held, the only
    // voices sent to the room, so the place has a room and a step none.
    const gusts = Math.max(3, Math.round(timeline.duration / 3));
    for (let j = 0; j < gusts; j++) {
      const at = Math.max(0, (j + 0.15 + 0.6 * R('air', 'at', j)) * (timeline.duration / gusts) - 0.5);
      add(voice(ctx, R, `gust ${j}`, at, {
        partials: [[1, 0]], level: AIR * (0.55 + 0.45 * R('air', 'level', j)),
        tail: { level: 1, rise: 0.9 + 0.9 * R('air', 'rise', j), length: 1.6 + 1.4 * R('air', 'length', j), colour: 320 * 2 ** R('air', 'colour', j) },
        pan: 0.9 * (R('air', 'pan', j) - 0.5), distance: 0.5,
      }), 0.6);
    }

    s.falls.forEach((fall, i) => {
      const at = fall.frame / timeline.hz;
      const sec = at / timeline.duration;
      // The phrase: the walk gathers weight, peaks past the middle, eases off.
      const phrase = 0.7 + 0.4 * Math.sin(Math.PI * Math.min(1, sec * 1.1));
      const velocity = Math.min(1, fall.weight * phrase * heavy);
      // Placed where the heel lands in the frame the camera shows.
      const pan = Math.max(-1, Math.min(1, (fall.x / W - 0.5) * 0.8 + (fall.foot ? 0.1 : -0.1)));
      const far = AWAY + (fall.foot ? 0.18 : 0);
      const away = 10 ** (-0.75 * far);
      const pitch = (fall.foot ? 72 : 66) * (1 + 0.08 * (R('fall', 'pitch', i) - 0.5));
      // Over half velocity the thump grows at half the rate, to 0.74 at full:
      // with the voice's own variation, up to 3 dB, it stays at most 3 dB
      // over the air's low tone at any weight, and the quiet steps keep their
      // level.
      add(voice(ctx, R, `heel ${i}`, at, {
        pitch, partials: [[1, 1], [1.6, 0.7], [2.7, 0.35], [4.1, 0.12]],
        attack: 0.004, decay: 0.09, damp: 1.2,
        level: THUMP, velocity: Math.min(velocity, 0.26 + 0.48 * velocity), pan, vary: 0.6, distance: far,
      }));
      // The crunch: a crack of noise the moment the heel lands, up over 5 ms
      // and gone within 40 ms over a wide high band, then one to three dry
      // ticks in the next 50 ms as the weight rolls over grit to the ball,
      // each a few milliseconds, higher, its level 9 to 17 dB under the
      // crack's. Its level, colour, ticks and their places differ every step.
      // The crack rises over 5 ms, not 2, at the same peak: a shoe on brick
      // is no click, the owner's reference recording's steps taking 5 to 16
      // ms, 11 in the median, from 20 dB under their peak to it. The rise
      // does not set the AAC film's replay margin: the block of a crack's
      // onset codes at 24 to 30 dB by how much of it the block holds, either
      // side of replay's 25 dB floor, with a 2, 5 or 10 ms rise alike.
      const crack = CRACK * velocity * away * 10 ** (0.15 * (R('fall', 'crack', i) - 0.5));
      const colour = (fall.foot ? 950 : 1250) * (0.85 + 0.3 * velocity) * 2 ** (0.5 * (R('fall', 'colour', i) - 0.5));
      const ticks = 1 + Math.floor(3 * R('fall', 'grit', i));
      add(grit(ctx, R, `crunch ${i}`, at, pan, [
        { from: 0, rise: 0.005, length: 0.03 + 0.012 * R('fall', 'roll', i), colour, band: 2.8, level: crack },
        ...Array.from({ length: ticks }, (_, t) => ({
          from: 0.008 + 0.045 * R('fall', 'tick', 4 * i + t), rise: 0.0003, length: 0.003 + 0.004 * R('fall', 'grain', 4 * i + t),
          colour: colour * 2 ** (0.3 + 0.9 * R('fall', 'tick colour', 4 * i + t)), band: 2,
          level: crack * 10 ** (-(9 + 8 * R('fall', 'tick level', 4 * i + t)) / 20),
        })),
      ]));
      // The scuff: the back toe, the other foot's, scrapes off the ground, a
      // brief rough rasp around its lift, near when this fall is the far
      // foot's: its rise of 10 to 20 ms against its fall puts its peak 6 to
      // 9 ms in, 9 to 19 dB under its level, and it is over within 80 ms, its
      // band and level its own.
      const lift = fall.push / timeline.hz + 0.02 * (R('fall', 'lift', i) - 0.5);
      add(grit(ctx, R, `scuff ${i}`, lift - 0.03, Math.max(-1, pan - 0.05), [{
        from: 0, rise: 0.01 + 0.01 * R('fall', 'drag', i), length: 0.04 + 0.025 * R('fall', 'scuff', i),
        colour: (fall.foot ? 1400 : 1100) * 2 ** (0.6 * (R('fall', 'scuff colour', i) - 0.5)), band: 1.8, rough: 0.6,
        level: SCRAPE * velocity * 10 ** (-0.75 * (AWAY + (fall.foot ? 0 : 0.18))) * 10 ** (0.2 * (R('fall', 'scrape', i) - 0.5)),
      }]));
    });
    // A foot coming down on a plant: a soft dry rustle on the frame of its
    // first touch, a detail low under the air and far, sent nowhere. A taller
    // plant and a harder press rustle more; grass is a short soft hiss, a
    // stalk a longer drier crackle of its seed head, a shrub a fuller, lower
    // brush of leaves; each its own length, colour and level.
    s.brushes.forEach((b, i) => {
      const at = b.frame / timeline.hz;
      const x = b.x - s.poses[b.frame].cam + ANCHOR;
      const pan = Math.max(-1, Math.min(1, (x / W - 0.5) * 0.8 + (b.foot ? 0.1 : -0.1)));
      const away = 10 ** (-0.75 * (AWAY + (b.foot ? 0.18 : 0)));
      const { rise, length, colour, band, rough } = {
        grass: { rise: 0.012, length: 0.05, colour: 3000, band: 2.6, rough: 0.5 },
        bloom: { rise: 0.012, length: 0.06, colour: 2800, band: 2.6, rough: 0.5 },
        stalk: { rise: 0.008, length: 0.08, colour: 3800, band: 2.4, rough: 0.7 },
        shrub: { rise: 0.02, length: 0.09, colour: 2200, band: 2.8, rough: 0.5 },
      }[b.kind];
      add(grit(ctx, R, `rustle ${i}`, at, pan, [{
        from: 0, rise, length: length * (1 + 0.5 * R('brush', 'length', i)),
        colour: colour * 2 ** (0.5 * (R('brush', 'colour', i) - 0.5)), band, rough,
        level: RUSTLE * (0.4 + 0.6 * Math.min(1, b.size / 36)) * (0.5 + 0.5 * b.peak) * away * 10 ** (0.15 * (R('brush', 'level', i) - 0.5)),
      }]));
    });
    sumInto(ctx, voices, dry);
    sumInto(ctx, sends, hall);
  },
};

/**
 * The keyed figure on frame `f`: where the camera is, the hips and both legs
 * from hip to toe, and what the spine and arms are keyed to do; `overlap`
 * then hangs the upper body on them. `bob` is how far the hips sink and rise.
 */
function poseAt(s, f, bob) {
  const w = s.walk(f);
  const step = Math.floor(w);
  const phase = w - step;
  const hipX = lerp(over(s, step), over(s, step + 1), PUSH(phase));
  const feet = [0, 1].map((j) => foot(s, w, j));
  // The hips sit as the step asks, but never so high a leg cannot reach.
  let hipY = GY - HIP_H - bob * HIPS(phase);
  for (const ft of feet) {
    const dx = ft.ankle[0] - hipX;
    hipY = Math.max(hipY, ft.ankle[1] - Math.sqrt(Math.max(0, REACH * REACH - dx * dx)));
  }
  const hip = [hipX, hipY];
  for (const ft of feet) ft.knee = knee(hip, ft.ankle);
  // The spine leans into the walk, a little further as the back foot pushes.
  // Each arm opposes its own leg and bends at the elbow as it comes forward.
  const lean = 0.1 + 0.03 * HIPS(phase);
  const swing = [0, 1].map((j) => 0.5 * ARM(mod(w - j - 0.2, 2)));
  const reach = swing.map((a, j) => a + 0.25 + 0.4 * Math.max(0, ARM(mod(w - j - 0.2, 2))));
  return { cam: camAt(s, f), w, hip, feet, lean, swing, reach };
}

/** Where the hips are over contact `k`: between the heels, over the ankles. */
function over(s, k) { return (s.plants[k] + s.plants[k + 1]) / 2 + 10; }

/**
 * The camera on frame `f`. It keeps the walker's mean pace, the hips' place
 * over each contact averaged over about two steps, so it eases from one
 * step's speed into the next instead of changing speed on the contact.
 * Before the first frame it carries on at the first step's speed.
 */
function camAt(s, f) {
  const track = (x) => {
    if (x < 0) return over(s, 0) + x * (over(s, 1) - over(s, 0)) / s.walk.contacts[1];
    const w = s.walk(x);
    const step = Math.floor(w);
    return lerp(over(s, step), over(s, step + 1), w - step);
  };
  const h = Math.round(s.params.pace / 2);
  let sum = 0;
  let n = 0;
  for (let d = -2 * h; d <= 2 * h; d++) {
    const k = 2 * h + 1 - Math.abs(d);
    sum += k * track(f + d);
    n += k;
  }
  return sum / n;
}

/**
 * The upper body over the keyed poses, each part hung on a damped spring
 * behind the part that carries it, so nothing arrives at once. The chest
 * carries on as the hips check at each contact and is left behind as they
 * push, the head sinks on after the body lands and nods back up, each forearm
 * drags behind its upper arm and swings on past it as the arm turns, and each
 * hand trails its forearm both ways, bending back only a little. The
 * shoulders turn against the hips: each socket goes forward with its arm.
 * `cycle` is the frames of two steps, the walk's period, run once first so
 * the springs are already moving on frame 0.
 */
function overlap(poses, cycle) {
  const along = (key, i) => poses.map((q) => (i === undefined ? q[key] : q[key][i]));
  const chest = trail(poses.map((q) => q.hip[0] - q.cam), 2.2, 0.45, cycle);
  const sink = trail(along('hip', 1), 2.6, 0.35, cycle);
  // The head nods as far as the body's fall outruns it, eased towards a soft
  // limit, and settles on a well-damped neck of its own.
  const nod = trail(poses.map((q, f) => 0.12 * Math.tanh(0.1 * (sink[f] - q.hip[1]))), 4, 0.7, cycle);
  const fore = [0, 1].map((j) => trail(along('reach', j), 2.3, 0.45, cycle));
  const wrist = fore.map((a) => trail(a, 3.6, 0.5, cycle));
  poses.forEach((q, f) => {
    const [hipX, hipY] = q.hip;
    const lean = q.lean + 0.025 * (chest[f] - (hipX - q.cam));
    const shoulder = [hipX + Math.sin(lean) * TORSO, hipY - Math.cos(lean) * TORSO];
    q.shoulder = shoulder;
    q.head = [shoulder[0] + Math.sin(lean + nod[f]) * 24, shoulder[1] - Math.cos(lean + nod[f]) * 24];
    q.arms = [0, 1].map((j) => {
      const swing = q.swing[j];
      const socket = [shoulder[0] + 7 * swing * Math.cos(lean), shoulder[1] + 7 * swing * Math.sin(lean)];
      // An elbow folds forward only.
      const turn = Math.max(swing + 0.05, fore[j][f]);
      const elbow = add(socket, [Math.sin(swing) * UPPER, Math.cos(swing) * UPPER]);
      const hand = add(elbow, [Math.sin(turn) * FORE, Math.cos(turn) * FORE]);
      // A wrist flexes far forward but bends back only a little.
      const flex = wrist[j][f] - turn;
      const palm = turn + (flex < 0 ? 0.3 * Math.tanh(flex / 0.3) : flex);
      return { socket, elbow, hand, tip: add(hand, [Math.sin(palm) * HAND, Math.cos(palm) * HAND]) };
    });
  });
}

/**
 * A part on a damped spring of `hz` and `damping` (1 is critical) behind a
 * value read once a frame from `target`, taken as straight between frames:
 * where the part is on each frame. The walk is run over its first `cycle`
 * frames once before, so on frame 0 the part moves as it does a cycle in.
 */
function trail(target, hz, damping, cycle) {
  const w = 2 * Math.PI * hz;
  const sub = 8;
  const dt = 1 / (HZ * sub);
  const out = new Float64Array(target.length);
  let y = target[0];
  let v = 0;
  for (const end of [cycle, target.length]) {
    for (let f = 0; f < end; f++) {
      out[f] = y;
      const a = target[f];
      const b = target[Math.min(f + 1, target.length - 1)];
      for (let i = 0; i < sub; i++) {
        v += (w * w * (lerp(a, b, i / sub) - y) - 2 * damping * w * v) * dt;
        y += v * dt;
      }
    }
  }
  return out;
}

/**
 * A plant's press on each frame: `raw`, the foot's, on every frame one holds
 * it, and from the frame the foot leaves a damped spring of `hz` and
 * `damping`, let go at rest from the pressed pose, until the next touch. It
 * is no follower of `raw`: a follower rose the frame a brief touch ended and
 * then bent down again with no foot on it.
 */
function release(raw, hz, damping) {
  const w = 2 * Math.PI * hz;
  const sub = 8;
  const dt = 1 / (HZ * sub);
  const out = new Float64Array(raw.length);
  let y = 0;
  let v = 0;
  raw.forEach((target, f) => {
    if (target > 0) { y = target; v = 0; } else {
      for (let i = 0; i < sub; i++) {
        v -= (w * w * y + 2 * damping * w * v) * dt;
        y += v * dt;
      }
    }
    out[f] = y;
  });
  return out;
}

/**
 * Plant `i` of the seeded set `key`, a `kind` rooted at `x`, `y`: its height,
 * colour, head and blades, darker the nearer it is rooted, and with a blade
 * more for every 40 units in front of the ground line.
 */
function tuft(R, key, i, x, y, kind) {
  const shade = R(key, 'shade', i);
  const dry = R(key, 'dry', i);
  const h = { grass: 7, bloom: 7, stalk: 20, shrub: 8 }[kind] + { grass: 12, bloom: 12, stalk: 24, shrub: 10 }[kind] * R(key, 'height', i);
  const hue = { grass: mix(OLIVE, STRAW, 0.8 * dry ** 1.5), bloom: mix(OLIVE, SAGE, dry), stalk: mix(STRAW, RUST, dry), shrub: mix(SAGE, OLIVE, dry) }[kind];
  const colour = mix(mix(GROUND, hue, (kind === 'grass' ? 0.55 : 0.75) + (kind === 'grass' ? 0.35 : 0.25) * shade),
    INK, (y - GY) / 400 + (kind === 'shrub' ? 0.12 : 0));
  const head = kind === 'bloom' ? mix(BLOOMS[Math.floor(3 * R(key, 'bloom', i))], INK, (y - GY) / 400)
    : kind === 'grass' ? null : mix(colour, SUN, kind === 'shrub' ? 0.18 : 0.3);
  return { x, y, h, kind, colour, head, shade, blades: (kind === 'stalk' ? 2 : 3) + Math.floor(3 * R(key, 'blades', i)) + Math.floor((y - GY) / 40) };
}

/** Foot `j` at stride count `w`: planted about its heel or toe, or swinging. */
function foot(s, w, j) {
  const step = Math.floor(w);
  // The contact this foot last landed on, and how far into its life it is.
  const k = mod(step, 2) === j ? step : step - 1;
  const u = w - k;
  const P = s.plants[k + 1];
  let heel;
  let a;
  let planted = true;
  if (u <= TOE_OFF) {
    a = ROLL(u);
    heel = a <= 0 ? [P, GY] : sub([P + TOE, GY], rot([TOE, 0], a));
  } else {
    planted = false;
    const v = (u - TOE_OFF) / (2 - TOE_OFF);
    const from = sub([P + TOE, GY], rot([TOE, 0], OFF));
    a = TILT(v);
    heel = [lerp(from[0], s.plants[k + 3], SWING(v)), lerp(from[1], GY, v) - LIFT(v)];
    // The toe never goes into the ground on its way through.
    heel[1] -= Math.max(0, heel[1] + TOE * Math.sin(a) - GY);
  }
  const at = (p) => add(heel, rot(p, a));
  return { heel, toe: at([TOE, 0]), ball: at([BALL, 0]), ankle: at(ANKLE), angle: a, planted, contact: k };
}

/** The knee between a hip and an ankle, bent forward, each bone its length. */
function knee(hip, ankle) {
  const dx = ankle[0] - hip[0];
  const dy = ankle[1] - hip[1];
  const d = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 1e-9);
  const c = Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)));
  const base = Math.atan2(dy, dx);
  const turn = Math.acos(c);
  // Of the two ways the knee can fold, a walker's goes forward.
  const a = [base - turn, base + turn].map((t) => [hip[0] + Math.cos(t) * THIGH, hip[1] + Math.sin(t) * THIGH]);
  return a[0][0] > a[1][0] ? a[0] : a[1];
}

/**
 * The figure: a jointed mannequin of rounded parts. With `flat`, one colour,
 * as its shadow; otherwise every limb lit along its sun side, the far limbs
 * darker with a dimmer light and a dark rim on the shade side, joints as pins.
 */
function figure(g, pose, flat) {
  const { hip, shoulder, head, feet, arms } = pose;
  const tone = (near) => flat || (near ? WOOD : WOOD_FAR);
  const pin = (p, r) => {
    if (flat) return;
    g.fillStyle = JOINT;
    g.beginPath();
    g.arc(p[0], p[1], r, 0, Math.PI * 2);
    g.fill();
  };
  // A limb's parts with one rim around them all, so a near limb reads
  // against the body it crosses; the shadow is one flat shape.
  const parts = (list, near) => {
    if (!flat) {
      g.strokeStyle = mix(tone(near), INK, 0.45);
      for (const [a, b, w] of list) capsule(g, a, b, w + 3);
    }
    g.strokeStyle = tone(near);
    for (const [a, b, w] of list) capsule(g, a, b, w);
  };
  const leg = (ft, near) => {
    parts([[hip, ft.knee, 15], [ft.knee, ft.ankle, 12], [ft.heel, ft.toe, 8], [ft.ankle, lerp2(ft.heel, ft.ball, 0.35), 9]], near);
    if (!flat) shine(g, hip, ft.knee, ft.ankle, near);
    pin(ft.knee, 3.4);
    pin(ft.ankle, 2.6);
  };
  const arm = (a, near) => {
    parts([[a.socket, a.elbow, 11], [a.elbow, a.hand, 9], [a.hand, a.tip, 11]], near);
    if (!flat) shine(g, a.socket, a.elbow, a.hand, near);
    pin(a.elbow, 2.6);
  };
  arm(arms[1], false);
  leg(feet[1], false);
  // The body: a pelvis, a waist, a chest and a neck, one rounded piece each.
  const waist = lerp2(hip, shoulder, 0.42);
  parts([[hip, waist, 26], [waist, lerp2(hip, shoulder, 0.86), 32],
    [lerp2(shoulder, head, 0.2), lerp2(shoulder, head, 0.55), 9], [head, add(head, [0.5, 0]), 32]], true);
  if (!flat) {
    g.strokeStyle = mix(WOOD, SUN, 0.35);
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(hip[0] - 9, hip[1] - 8);
    g.lineTo(waist[0] - 13, waist[1] - 14);
    g.stroke();
    pin(hip, 4);
  }
  leg(feet[0], true);
  if (!flat) {
    // It looks where it walks.
    g.fillStyle = INK;
    g.beginPath();
    g.arc(head[0] + 9, head[1] - 3, 1.9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = mix(WOOD, SUN, 0.45);
    g.beginPath();
    g.arc(head[0] - 5, head[1] - 6, 5, 0, Math.PI * 2);
    g.fill();
  }
  arm(arms[0], true);
  if (!flat) pin(arms[0].socket, 3.4);
}

/**
 * Dry grit from `at`, placed at `pan`: one buffer holding each of `parts`,
 * `{ from, rise, length, colour, band, level, rough }`, a burst of seeded
 * noise through a band `band` octaves wide around `colour` hertz, starting
 * `from` seconds in, rising linearly over `rise` while, from the same first
 * sample, falling to -60 dB over `length`, then gone within 5 ms. So it peaks
 * `min(rise, length / 6.9)` seconds in, under `level`, the RMS of its noise
 * before that envelope, by the fall so far: the crack 4 to 5 ms in, 7 to 10
 * dB under, the scuff 6 to 9 ms in, 9 to 19 dB under.
 * `rough`, 0 to 1, makes it catch and slip: its level wanders by that much,
 * about 150 times a second. Nothing in it rings or glides: no sine, no pitch.
 * The noise is `R(name, 'part <i>', sample)` and the wander
 * `noise2(R, seconds * 150, i, name + ' drag')`. The source carries `name` as
 * its `grit` tag, `'crunch 3'` or `'rustle 0'`: a label to tell the voices
 * apart by, never heard.
 */
function grit(ctx, R, name, at, pan, parts) {
  const sr = ctx.sampleRate;
  const stop = 0.005;
  const buf = ctx.createBuffer(1, Math.ceil((Math.max(...parts.map((p) => p.from + p.length)) + stop) * sr), sr);
  const data = buf.getChannelData(0);
  parts.forEach(({ from, rise, length, colour, band, level, rough = 0 }, p) => {
    // Two state-variable band-passes in a row, as an ambience's bed.
    const k = (2 ** band - 1) / 2 ** (band / 2) / Math.sqrt(Math.SQRT2 - 1);
    const g = Math.tan((Math.PI * colour) / sr);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const st = [0, 0, 0, 0];
    const start = Math.round(from * sr), fallN = Math.ceil(length * sr), riseN = Math.max(1, Math.round(rise * sr)), stopN = Math.ceil(stop * sr);
    const y = new Float64Array(fallN + stopN);
    let power = 0;
    for (let i = 0; i < y.length; i++) {
      let v = 2 * R(name, `part ${p}`, i) - 1;
      for (let j = 0; j < 4; j += 2) {
        const v3 = v - st[j + 1];
        const v1 = a1 * st[j] + a2 * v3;
        const v2 = st[j + 1] + a2 * st[j] + a3 * v3;
        st[j] = 2 * v1 - st[j];
        st[j + 1] = 2 * v2 - st[j + 1];
        v = k * v1;
      }
      y[i] = v;
      power += v * v;
    }
    const scale = level / Math.sqrt(power / y.length);
    for (let i = 0; i < y.length; i++) {
      const up = Math.min(1, i / riseN);
      const down = Math.exp((-Math.log(1000) * i) / fallN);
      const out = i <= fallN ? 1 : 1 - (i - fallN) / stopN;
      const drag = rough > 0 ? 1 - rough * noise2(R, (i / sr) * 150, p, `${name} drag`) : 1;
      data[start + i] += y[i] * scale * up * down * out * drag;
    }
  });
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.grit = name;
  src.start(at);
  const place = ctx.createStereoPanner();
  place.pan.value = pan;
  src.connect(place);
  return place;
}

/**
 * The plants passing at the ground's own speed, those `keep` accepts: grass,
 * tall stalks with seed heads, low shrubs and tufts in flower. A gust travels
 * across the field and bends them, the stalks on their own beat as well, and
 * a foot over one presses it as low as its sole, by the press track the
 * build gave it.
 */
function plants(g, s, f, cam, keep) {
  const { R } = s.world;
  const left = cam - ANCHOR - 20;
  g.lineCap = 'round';
  for (const t of s.world.tufts) {
    // A plant is kept until all it can reach, leaning either way, is out of view.
    const grow = 1 + (t.y - GY) / 120;
    if (!keep(t) || t.x < left - t.h * grow || t.x > left + W + 40 + t.h * grow) continue;
    const gust = noise2(R, t.x * 0.006 - f * 0.09, 0.5, 'wind') - 0.5;
    // Pressed, a plant bends forward and lies low, under the sole over it;
    // sprung back past upright, it leans back a little before it settles.
    const press = t.press ? t.press[f] : 0;
    const lean = 0.25 + 1.1 * gust + 1.2 * press;
    const tall = t.h * (1 - 0.9 * Math.max(0, press)) * grow;
    if (t.kind === 'shrub') {
      shrub(g, t, tall, lean);
      continue;
    }
    const stalk = t.kind === 'stalk';
    g.strokeStyle = t.colour;
    g.lineWidth = stalk ? 1.3 : 1.6;
    g.beginPath();
    const tips = [];
    for (let b = 0; b < t.blades; b++) {
      const spread = (b / (t.blades - 1 || 1) - 0.5) * (stalk ? 0.35 : 0.9);
      const turn = stalk ? spread + 0.45 * lean + 0.07 * Math.sin(f / HZ * 5.5 + t.x + b * 1.7)
        : spread + lean * (0.6 + 0.4 * b / t.blades);
      const tip = [t.x + Math.sin(turn) * tall, t.y - Math.cos(turn) * tall, turn];
      g.moveTo(t.x + spread * 4, t.y);
      g.quadraticCurveTo(t.x + spread * 5, t.y - tall * 0.6, tip[0], tip[1]);
      tips.push(tip);
    }
    g.stroke();
    if (!t.head) continue;
    // A seed head along the top of each stalk, or a flower on each blade.
    g.fillStyle = t.head;
    g.beginPath();
    for (const [x, y, turn] of tips) {
      const [cx, cy, rx, ry, rot] = stalk ? [x + Math.sin(turn) * 2, y - Math.cos(turn) * 2, 1.4, 3.4, turn]
        : [x, y, 1.7 * Math.min(grow, 1.4), 1.7 * Math.min(grow, 1.4), 0];
      g.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot));
      g.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    }
    g.fill();
  }
}

/**
 * A low shrub `tall` high: overlapping lumps, highest in the middle, on a
 * contact shadow, each lit on its upper left by the low sun, its top swaying
 * a little with the gust's `lean`.
 */
function shrub(g, t, tall, lean) {
  const r = tall / 2;
  g.fillStyle = mix(GROUND, INK, 0.25);
  oval(g, t.x, t.y, r * 1.3, r * 0.25);
  // A lower row of lumps in shade, and a lit row above, between and behind them.
  for (const [row, colour] of [[1, t.head], [0, t.colour]]) {
    g.fillStyle = colour;
    g.beginPath();
    for (let b = row; b < 2 * t.blades - 1; b += 2) {
      const u = b / (2 * t.blades - 2) - 0.5;
      const up = (row ? 0.95 : 0.5) + 0.3 * Math.cos(u * 2.4);
      const x = t.x + u * r * 1.6 + lean * r * 0.3 * up - 0.15 * r * row;
      const rad = r * (0.5 + 0.1 * Math.sin(b * 2.3 + t.shade * 6));
      g.moveTo(x + rad, t.y - r * up);
      g.arc(x, t.y - r * up, rad, 0, Math.PI * 2);
    }
    g.fill();
  }
}

/**
 * A ridge's trees passing with it: flat silhouettes in three tones, round,
 * tall and narrow, or a low clump, each crown leaning a little in the wind.
 */
function grove(g, s, hill, cam, f) {
  const { R } = s.world;
  const off = cam * hill.depth;
  const seen = s.world.groves[hill.name].filter((t) => t.u - off > -20 && t.u - off < W + 20);
  const shape = (t) => {
    const x = t.u - off;
    const sway = (noise2(R, t.u * 0.02 - f * 0.05, 2.5, 'wind') - 0.5) * 0.15 * t.size;
    const [stem, rx, ry] = [[0.45, 0.42, 0.45], [0.2, 0.2, 0.62], [0, 0.55, 0.3]][t.kind];
    return { x, foot: t.y, top: t.y - stem * t.size, cx: x + sway, cy: t.y - (stem + ry * 0.8) * t.size, rx: rx * t.size, ry: ry * t.size };
  };
  const trees = seen.map((t) => [t, shape(t)]);
  g.strokeStyle = hill.tones[2];
  g.lineWidth = hill === FAR ? 1 : 1.4;
  g.lineCap = 'round';
  g.beginPath();
  for (const [, q] of trees) {
    if (q.top === q.foot) continue;
    g.moveTo(q.x, q.foot);
    g.lineTo(q.x, q.top);
  }
  g.stroke();
  for (let k = 0; k < 3; k++) {
    g.fillStyle = hill.tones[k];
    g.beginPath();
    for (const [t, q] of trees) {
      if (t.tone !== k) continue;
      g.moveTo(q.cx + q.rx, q.cy);
      g.ellipse(q.cx, q.cy, q.rx, q.ry, 0, 0, Math.PI * 2);
    }
    g.fill();
  }
}

/**
 * A bird on frame `f`'s place in `p`, its wings `span` long each side: tips
 * raised as `p.wing` goes to 1 and lowered towards -1, one tip higher as it banks.
 */
function wings(g, p, span) {
  if (p.x < -span || p.x > W + span) return;
  const lift = 0.5 * span * p.wing;
  const bank = p.bank * span;
  g.moveTo(p.x - span, p.y - lift + bank);
  g.quadraticCurveTo(p.x - span * 0.45, p.y - span * 0.18 - lift * 0.3, p.x, p.y + span * 0.08);
  g.quadraticCurveTo(p.x + span * 0.45, p.y - span * 0.18 - lift * 0.3, p.x + span, p.y - lift - bank);
}

/**
 * A bird's place and wingbeat on every frame. `at(t)` gives where it flies
 * at t seconds and how far it banks; the camera passes it slowly, as far off
 * as it is. It beats its wings `rate` times a second, and glides, wings held
 * a little up, wherever its own slow noise falls under `glide`.
 */
function fly(s, R, name, j, span, rate, glide, at) {
  const phase = R(name, 'phase', j);
  return {
    span,
    path: s.poses.map((q, f) => {
      const t = f / HZ;
      const [x, y, bank] = at(t);
      const beat = Math.min(1, Math.max(0.1, (noise2(R, t * 0.6, j, `${name} beat`) - glide) * 4));
      return { x: x - (q.cam - s.poses[0].cam) * 0.05, y, bank, wing: 0.3 * (1 - beat) + beat * Math.sin(2 * Math.PI * (rate * t + phase)) };
    }),
  };
}

/** A ridge of hills across the frame, passing at its depth, from seeded noise. */
function ridge(g, R, hill, cam) {
  g.fillStyle = hill.colour;
  g.beginPath();
  g.moveTo(0, GY);
  for (let x = 0; x <= W; x += 16) g.lineTo(x, crest(R, hill, x + cam * hill.depth));
  g.lineTo(W, GY);
  g.closePath();
  g.fill();
}

/** The height of a ridge's crest at `u` along it. */
function crest(R, hill, u) {
  const n = noise2(R, u * hill.scale, 0, hill.name) * 0.7 + noise2(R, u * hill.scale * 3.1, 1, hill.name) * 0.3;
  return hill.base - hill.rise * n;
}

/** A line from `a` to `b` with round ends, `width` wide, in the stroke colour. */
function capsule(g, a, b, width) {
  g.lineCap = 'round';
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
}

/**
 * The light along the sun's side of a limb, from the low sun on the left;
 * on a far limb a dimmer one, with a dark rim along its shade side.
 */
function shine(g, a, b, c, near) {
  g.strokeStyle = near ? mix(WOOD, SUN, 0.4) : mix(WOOD_FAR, SUN, 0.3);
  g.lineWidth = near ? 2.4 : 2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(a[0] - 4, a[1] + 2);
  g.lineTo(b[0] - 4, b[1]);
  g.lineTo(c[0] - 3, c[1] - 3);
  g.stroke();
  if (near) return;
  g.strokeStyle = mix(WOOD_FAR, INK, 0.3);
  g.beginPath();
  g.moveTo(a[0] + 3.5, a[1]);
  g.lineTo(b[0] + 3.5, b[1]);
  g.lineTo(c[0] + 3, c[1] - 2);
  g.stroke();
}

function oval(g, x, y, rx, ry) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

function wrap(v, lo, hi) { return lo + mod(v - lo, hi - lo); }
function mod(v, m) { return ((v % m) + m) % m; }
function rot(p, a) { const c = Math.cos(a); const n = Math.sin(a); return [p[0] * c - p[1] * n, p[0] * n + p[1] * c]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function lerp2(a, b, u) { return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)]; }
