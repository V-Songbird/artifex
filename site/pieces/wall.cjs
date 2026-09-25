// Shot 3c, the wall of every style. It begins where the Kandinsky shot ends:
// the Kandinsky, the knife gone. The camera draws back and the painting is a
// sheet lying on the table; a frame and its mat are lowered over it from
// above, their shadow ahead of them, and as the camera goes on drawing back
// the framed painting lies among one framed work of every other catalog
// style, each the style module's own drawing of the bird (see hang.js). Then
// the camera moves back onto the Kandinsky, the chosen one, until its frame
// fills the view.
//
// Beats, in seconds:
//   0.0-1.8    the camera draws back to the painting's sheet on the table
//   1.0-3.2    the frame is lowered over it and settles
//   3.4-6.6    the camera draws back to the whole hang
//   6.6-7.8    the whole hang, drifting
//   7.8-12.0   the camera moves onto the Kandinsky, still coming in at the last frame
//
// Looks to leave out:
// - a frame that appears: it comes down from above, its shadow ahead of it;
// - a change between styles: the camera only moves; every work stays as it is;
// - a still ending: the camera and the light move to the last frame.

'use strict';

const { span, ease } = require('../../core/time.js');
const P = require('./paper.js');
const Dr = require('./draft.js');
const Pc = require('./papercut.js');
const Im = require('./impasto.js');
const Sc = require('./scrape.js');
const Hg = require('./hang.js');

const BACK = [0, 1.8];                 // the camera draws back to the sheet
const DROP = [1.0, 3.2], LIFT = 300;   // the frame is lowered from LIFT units above the painting
const PULL = [3.4, 6.6];               // the camera draws back to the whole hang
const MOVE = [7.8, 12.6];              // ends after the shot, so the camera still moves at its last frame
const SWING = 0.35;                    // the light turns this much over the shot

/**
 * The camera `u` of the way from `p` to `q`, zooming evenly in scale and
 * moving across by `w(u)` of the way: late when drawing back, so the
 * Kandinsky holds its place until the rest is small, and early when going in,
 * so it is found before the camera closes on it.
 */
function between(p, q, u, w) {
  const a = w(u);
  return { c: [p.c[0] + (q.c[0] - p.c[0]) * a, p.c[1] + (q.c[1] - p.c[1]) * a], z: p.z * (q.z / p.z) ** u, turn: 0 };
}

/** The camera at second `sec`. */
function camera(s, sec) {
  const all = Hg.whole(s), drift = { c: [all.c[0] + 60, all.c[1] - 20], z: all.z * 0.97, turn: 0 };
  const sheet = { c: Im.CLOSE.c, z: 1, turn: 0 }, landed = { c: Im.CLOSE.c, z: 0.93, turn: 0 };
  if (sec < BACK[1]) return Dr.towards(Im.CLOSE, sheet, ease.inOut(span(BACK[0], BACK[1], sec)));
  if (sec < PULL[0]) return Dr.towards(sheet, landed, span(BACK[1], PULL[0], sec) * 0.5);
  const from = Dr.towards(sheet, landed, 0.5);
  if (sec < PULL[1]) return between(from, all, ease.inOut(span(PULL[0], PULL[1], sec)), (u) => u * u * u);
  if (sec < MOVE[0]) return Dr.towards(all, drift, span(PULL[1], MOVE[0], sec));
  return between(drift, Hg.chosen(s), ease.inOut(span(MOVE[0], MOVE[1], sec)), (u) => 1 - (1 - u) ** 3);
}

/** Build stage: how large the camera ever shows each work. */
function frames(s) {
  for (let sec = 0; sec <= 12; sec += 1 / 30) Hg.seen(s, camera(s, sec));
}

function draw(g, s, t, clock) {
  const sec = clock.seconds, v = camera(s, sec), m = Dr.shot(v);
  const d = g.getTransform ? g.getTransform() : null, dev = d ? Math.hypot(d.a, d.b) : 1;
  const pic = Hg.painting(g, s);
  // The works are made ahead once the wall is on screen, not while the stage
  // warms its first frame beside the Kandinsky, whose frames are the costlier.
  if (sec > 0) Hg.prepare(g, s, dev);
  const light = s.light + SWING * sec / 12;
  const down = ease.out(span(DROP[0], DROP[1], sec)), h = LIFT * (1 - down);
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  const kandinsky = (cg) => (pic.copy ? Dr.put(cg, pic) : Sc.paintImpasto(cg, s));
  Hg.drawHang(g, s, v, dev, light, kandinsky, (cg, k, sh, lx, ly) => {
    // The painting's sheet on the table, and the frame lowered over it: `h`
    // above it, larger for being nearer, a little turned; its shadow cast away
    // from the light, fainter and softer the higher it is.
    Hg.castShadow(cg, sh, Hg.SHEET, lx, ly, 0, 0.5);
    kandinsky(cg);
    const win = Hg.windowOf(k), out = Hg.grow(win, Hg.MAT + Hg.MOULD), sc = 1 + h * 0.0025, turn = 0.03 * (1 - down);
    cg.save();
    cg.translate(k.x, k.y);
    cg.rotate(turn);
    cg.scale(sc, sc);
    cg.translate(-k.x, -k.y);
    // The frame's shadow, a band a side: the window lets the light through.
    const dark = 0.8 * down * down;
    for (const r of [[out[0], out[1], out[2], win[1]], [out[0], win[3], out[2], out[3]], [out[0], win[1], win[0], win[3]], [win[2], win[1], out[2], win[3]]]) {
      Hg.castShadow(cg, sh, r, lx, ly, h, dark);
    }
    Hg.frame(cg, win, lx, ly);
    cg.restore();
  });
  Hg.glow(g, s, v, light, ease.inOut(span(0, DROP[1], sec)));
  g.restore();
}

module.exports = {
  name: 'site-wall',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 12, hz: 30 },
  build: [['lay the paper', P.lay], ['cut it', Pc.cut], ['spread the ground', Im.coat], ['lay the dabs', Im.dabs], ['outline the bird', Sc.hull], ['lay out the forms', Sc.forms], ['hang the works', Hg.hang], ['frame them', frames]],
  draw,
};
