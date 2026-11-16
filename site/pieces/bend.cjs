// Shot 2, the mirrors bow: the three straight mirrors of the kaleidoscope,
// pinned at their corners, bow inwards into arcs of three circles. The
// wallpaper they made turns hyperbolic: its reflections nest without end
// towards the one circle that crosses all three mirrors square (see
// inversion.js). Then the mirrors turn together on the sheet, as a
// kaleidoscope is turned, and the painting passes through them.
//
// It begins where the mirror shot ends: the wallpaper, the three mirrors
// standing on the sheet, their glints running.
//
// WHAT STAYS IS KEPT. The lifted scene is kept as the mirror shot keeps it,
// and read once for the reflections' colours; a frame lays the scene, the
// reflections folded pixel by pixel, and the rims. The mirror shot's last
// frame is kept too, made from the same copies: the first frame is that
// frame, and over the next few, while the mirrors have barely begun to bow,
// the folded reflections, drawn at under a third of the resolution, are laid
// over it more and more.
//
// Looks to leave out: those of the mirror shot (see mirror.cjs), and
// - a circle that appears: the limit circle is where the reflections the
//   straight mirrors spread over the frame come to crowd as the mirrors bow;
// - a lens laid over the frame: the region between the mirrors is the sheet
//   itself, and everything else a reflection of it.

'use strict';

const { keep, soft } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');
const Wt = require('./water.js');
const B = require('./brush.js');
const D = require('./dry.js');
const K = require('./kaleido.js');
const I = require('./inversion.js');
const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

const MIRROR = 209 / 30;    // the second of the mirror shot's last frame: its clock goes on here
const FADE = 0.2;           // seconds over which its reflections give way to the folded ones
const BOW = [0.05, 3.2];    // the mirrors bow between these seconds
// and stop where the angles at the corners are a fifth of a half turn, so the
// images close up again, in the hyperbolic group *555, its limit circle about
// as tall as the frame (see inversion.js)
const BOWED = 0.4;
const TURN = 2.5;           // from this second the mirrors turn together about the triangle's centre
const ABSORB = 0.1;         // what a reflection takes from the light, once the mirrors have bowed

function bowAt(sec) {
  const u = Math.max(0, Math.min(1, (sec - BOW[0]) / (BOW[1] - BOW[0])));
  return BOWED * u * u * (3 - 2 * u);
}

const turnAt = (sec) => 0.03 * Math.max(0, sec - TURN) ** 2;

/** The mirror shot's last frame, from the kept lifted `scene`: the scene, its reflections and the mirrors. */
function wallpaper(g, s, scene) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(scene, 0, 0);
  g.restore();
  K.drawReflections(g, s, MIRROR, scene);
  K.drawMirrors(g, s, MIRROR, soft);
}

/** The lifted scene drawn directly, for the reflections' colours. */
function lifted(g, s) {
  const sheet = keep(g, s, 'torn', K.torn);
  if (sheet) K.pieces(g, s, K.LIFT, sheet, true);
}

function frame(g, s, sec) {
  const bow = bowAt(sec), cs = I.circles(s, bow, turnAt(sec));
  // Made on the first frame, and primed with frames from the start of the bow, its middle
  // and the end, so every copy and every kind of mark is ready.
  const sheet = keep(g, s, 'torn', K.torn, (pg, ps) => { frame(pg, ps, 0.1); frame(pg, ps, 2.6); frame(pg, ps, 5.5); });
  const tex = sheet && I.texture(s, lifted);
  if (!tex) {
    // A surface that keeps no copies: the torn sheet as it lies, and the rims.
    D.dried(g, s);
    D.drawTears(g, s, Infinity, s.tearOrder);
    I.drawRims(g, s, cs, MIRROR + sec, bow, soft);
    return;
  }
  const scene = K.scene(g, s, sheet), into = Math.min(1, sec / FADE);
  const under = into < 1 ? keep(g, s, 'wallpaper', (cg, cs2) => wallpaper(cg, cs2, scene)) : scene;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(under, 0, 0);
  g.restore();
  if (into <= 0) return;
  g.save();
  g.globalAlpha = into;
  I.reflect(g, cs, (ABSORB * bow) / BOWED, tex);
  I.drawRims(g, s, cs, MIRROR + sec, bow, soft);
  g.restore();
}

/**
 * Heard: each mirror's glass taking the strain as it bows, creaking in its
 * pins in short dark groans and bright ticks, most while it bows fastest,
 * over the soft rush of the glass flexing; then the kaleidoscope's ratchet,
 * clicking faster as the turn gathers, each click a little apart.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  const bowed = BOW[1] - BOW[0];
  // Each mirror's glass flexing: a soft rush that grows as it bows fastest and brightens with the strain.
  s.triangle.forEach((p, k) => pairs.push(...Sd.placed(Sd.swell(R, 'flex ' + k, BOW[0] + 0.3 * k, bowed, (u) => (300 + 90 * k) * (1 + 2 * u), 0.03 * (0.7 + 0.3 * R('flex', 'level', k)), 0.55),
    { pan: Sd.panX(p[0]), distance: 0.35 })));
  for (let j = 0; j < 30; j++) {
    // Creaks of the glass in its pins, most where the bow moves fastest: dark groans, and now and then a bright tick.
    const u = 0.5 - Math.cos(Math.PI * ((j + R('strain', 'at', j)) / 30)) / 2, at = BOW[0] + u * bowed, p = s.triangle[Math.floor(3 * R('strain', 'which', j))];
    const bright = R('strain', 'kind', j) < 0.25;
    pairs.push([at, {
      ...(bright ? Sd.snap(3800 + 2500 * R('strain', 'colour', j), 0.003, 0.14) : Sd.snap(320 + 600 * R('strain', 'colour', j), 0.02 + 0.04 * R('strain', 'length', j), 0.4)),
      velocity: (0.15 + 0.85 * Math.sin(Math.PI * u)) * (0.4 + 0.6 * R('strain', 'level', j)), vary: 0.7, pan: Sd.panX(p[0]), distance: 0.15 + 0.5 * R('strain', 'far', j),
    }]);
  }
  for (let k = 1; ; k++) {
    const at = TURN + Math.sqrt((k * Sd.DETENT) / 0.03);
    if (at >= end) break;
    pairs.push([at, { ...Sd.detent(0.06 * (at - TURN), k, R), pan: 0.1 + 0.1 * (R('detent', 'pan', k) - 0.5) }]);
  }
  Sd.mix(ctx, R, Sd.place(ctx, R, 'bend', pairs, end), { size: 1.6, send: 0.35, level: 5.5 });
}

/**
 * While the shot is scrolled: the bowed glass holding its strain, a creak in
 * one pin or another now and then, a bright tick of glass far off, and at
 * times the soft rush of a mirror flexing.
 */
sound.ambience = Sd.ambience('bend air', (R, loop) => [
  ...Sd.scatter(R, 'creak', loop, 1.6, (j, swell) => ({
    ...Sd.snap(300 + 600 * R('creak', 'colour', j), 0.02 + 0.05 * R('creak', 'length', j), 0.18),
    velocity: swell * (0.2 + 0.8 * R('creak', 'level', j) ** 1.5), vary: 0.7, pan: 1.4 * (R('creak', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('creak', 'far', j),
  })),
  ...Sd.scatter(R, 'glint', loop, 1.3, (j, swell) => ({
    ...Sd.snap(3800 + 2800 * R('glint', 'colour', j), 0.002 + 0.003 * R('glint', 'length', j), 0.1),
    velocity: swell * (0.2 + 0.8 * R('glint', 'level', j) ** 2), vary: 0.7, pan: 1.6 * (R('glint', 'pan', j) - 0.5), distance: 0.5 + 0.5 * R('glint', 'far', j),
  })),
  ...Sd.scatter(R, 'flex', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'flex ' + j, at, 1.8, (u) => (320 + 200 * R('flex', 'colour', j)) * (1 + 1.4 * Math.sin(Math.PI * u)), 0.025 * swell * (0.4 + 0.6 * R('flex', 'level', j))),
    { pan: 1.2 * (R('flex', 'pan', j) - 0.5), distance: 0.5 })),
], { level: 4.2 });

module.exports = {
  name: 'site-bend',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 6, hz: 30 },
  // The mirror shot's own knobs, so the mirrors that bow are the ones that stood.
  params: {
    strokes: { min: 12, max: 44, value: 30, meaning: 'how many strokes the brush laid' },
    reach: { min: 160, max: 620, value: 380, meaning: 'how far a stroke travelled along the current, in design units' },
    load: { min: 0.5, max: 1.3, value: 1, meaning: 'how dark the ink was: under 1 the brush was let down with water' },
    side: { min: 220, max: 460, value: 330, meaning: 'the length of each mirror: the side of the triangle the wallpaper repeats' },
  },
  build: [
    ['lay the paper', P.lay],
    ['plot the wordmark', M.plot],
    ['wet the sheet', Wt.soak],
    ['paint', B.paint],
    ['tear', D.tear],
    ['stand the mirrors', K.place],
  ],
  draw(g, s, t, clock) {
    frame(g, s, clock.seconds);
  },
  sound,
};
