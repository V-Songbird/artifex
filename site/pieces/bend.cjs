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
};
