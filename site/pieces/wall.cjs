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
// The camera is hang.js's, which the unstick seam goes on from.
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
const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

const DROP = [1.0, 3.2], LIFT = 300;   // the frame is lowered from LIFT units above the painting
const SWING = 0.35;                    // the light turns this much over the shot

function draw(g, s, t, clock) {
  const sec = clock.seconds, v = Hg.camera(s, sec), m = Dr.shot(v);
  const d = g.getTransform ? g.getTransform() : null, dev = d ? Math.hypot(d.a, d.b) : 1;
  const pic = Hg.painting(g, s);
  // The works are made ahead once the wall is on screen, not while the stage
  // warms its first frame beside the Kandinsky, whose frames are the costlier.
  if (sec > 0) Hg.prepare(g, s, dev);
  const light = s.light + SWING * sec / Hg.WALL_SECONDS;
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

/**
 * Heard: the frame coming down over the painting, the air it pushes ahead
 * of it a breath that closes as it nears, and its landing: the dull knock
 * of wood on the table, the mat's flat slap and the glass ticking once as
 * it settles. As the camera draws back, each framed work that comes into
 * view is a faint tap of its own frame, where it lies, far off; and as the
 * camera moves onto the Kandinsky the room closes in with a slow breath.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  const fall = DROP[1] - DROP[0];
  pairs.push([DROP[0], { ...Sd.breath(500, 0.5, fall, 0.06), sweep: [[0, 1600], [fall, 300]], velocity: 0.8, pan: 0, distance: 0.1 }]);
  // The landing: the frame is down, to the ear, a little before it has eased to rest.
  const land = DROP[0] + 0.8 * fall;
  pairs.push([land, { ...Sd.snap(260, 0.035, 0.35), velocity: 1, vary: 0.4, pan: -0.1, distance: 0 }]);
  pairs.push([land + 0.015, { ...Sd.snap(900, 0.02, 0.3), velocity: 0.7, vary: 0.4, pan: 0.1, distance: 0 }]);
  for (let j = 0; j < 4; j++) {
    pairs.push([land + 0.07 + 0.09 * j * (1 + 0.4 * R('glass', 'at', j)), { ...Sd.snap(4200 + 1800 * R('glass', 'colour', j), 0.003, 0.3), velocity: 0.5 * 0.6 ** j, vary: 0.6, pan: 0.5 * (R('glass', 'pan', j) - 0.5), distance: 0.05 }]);
  }
  // Each other work, the first time the camera shows half of it: a tap of its frame, where it is on screen.
  const met = new Set([s.hang.k]);
  for (let sec = 3.4; sec < 7.8; sec += 1 / 30) {
    const v = Hg.camera(s, sec), hw = 600 / v.z, hh = 400 / v.z;
    for (const w of s.hang.works) {
      if (met.has(w) || Math.abs(w.x - v.c[0]) > hw || Math.abs(w.y - v.c[1]) > hh) continue;
      met.add(w);
      pairs.push([sec, {
        ...Sd.snap(500 + 1500 * R('work', 'colour', w.i), 0.01 + 0.015 * R('work', 'length', w.i), 0.25),
        velocity: 0.3 + 0.5 * R('work', 'level', w.i), vary: 0.7, pan: Sd.panX(600 + (w.x - v.c[0]) * v.z), distance: 0.35 + 0.4 * R('work', 'far', w.i),
      }]);
    }
  }
  pairs.push(...Sd.placed(Sd.swell(R, 'close', 7.9, 3.6, (u) => 220 + 500 * u * u, 0.05), { pan: 0, distance: 0.3 }));
  Sd.mix(ctx, R, Sd.place(ctx, R, 'wall', pairs, end), { level: 5.3 });
}

/**
 * While the shot is scrolled: framed works lying in a quiet room. A
 * moulding ticks as its wood moves, a pane of glass gives a fine click,
 * and at times a slow dark breath of the room, far off.
 */
sound.ambience = Sd.ambience('wall air', (R, loop) => [
  ...Sd.scatter(R, 'pane', loop, 0.9, (j, swell) => ({
    ...Sd.snap(3600 + 2800 * R('pane', 'colour', j), 0.002 + 0.003 * R('pane', 'length', j), 0.12),
    velocity: swell * (0.15 + 0.85 * R('pane', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('pane', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('pane', 'far', j),
  })),
  ...Sd.scatter(R, 'wood', loop, 1.9, (j, swell) => ({
    ...Sd.snap(420 + 700 * R('wood', 'colour', j), 0.012 + 0.02 * R('wood', 'length', j), 0.26),
    velocity: swell * (0.3 + 0.7 * R('wood', 'level', j)), vary: 0.6, pan: 1.4 * (R('wood', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('wood', 'far', j),
  })),
  ...Sd.scatter(R, 'hall', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'hall ' + j, at, 1.6, (u) => (170 + 120 * R('hall', 'colour', j)) * (1 + 1.1 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('hall', 'level', j))),
    { pan: 1.2 * (R('hall', 'pan', j) - 0.5), distance: 0.5 })),
], { level: 4.75 });

module.exports = {
  name: 'site-wall',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: Hg.WALL_SECONDS, hz: 30 },
  build: [['lay the paper', P.lay], ['cut it', Pc.cut], ['spread the ground', Im.coat], ['lay the dabs', Im.dabs], ['outline the bird', Sc.hull], ['lay out the forms', Sc.forms], ['hang the works', Hg.hang], ['frame them', Hg.frames]],
  draw,
  sound,
};
