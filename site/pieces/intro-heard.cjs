// Shot 0 as it is heard: the intro with its sound. The site loads this apart
// from intro.cjs, the first time a visitor turns Listen on or asks for a
// film, so the sound's modules are not part of the first load.

'use strict';

const M = require('./wordmark.js');
const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

/**
 * Heard: the plotter's pen. It comes down on the paper with a small dull
 * tap, its nib scratches along the line, fine and dry, thickest while the
 * pen runs fastest, and it lifts with a lighter tick; the long last line is
 * one long scratch across the sheet, and the carriage leaves with a breath.
 * No motor tone: only the pen and the paper are heard.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  s.lines.forEach((l, i) => {
    const x0 = l.pts[0][0], x1 = l.pts[l.pts.length - 1][0], far = 0.05 + 0.2 * R('line', 'far', i);
    const tap = (at, x, colour, level, name) => pairs.push([at, {
      ...Sd.snap(colour * (0.8 + 0.4 * R(name, 'colour', i)), 0.012, 0.3), velocity: level * (0.5 + 0.5 * R(name, 'level', i)), vary: 0.6, pan: Sd.panX(x), distance: far,
    }]);
    tap(l.t0 - 0.03, x0, 420, 0.9, 'down');
    // Few enough that the stage builds the whole soundtrack between two frames while the film plays.
    pairs.push(...Sd.along(l.t0, l.t1, Math.round(2 + l.len / 45), (u) => u * u * (3 - 2 * u), (u, speed, j) => ({
      ...Sd.snap(2400 + 2600 * R('nib', 'colour', i * 100 + j), 0.004 + 0.008 * R('nib', 'length', i * 100 + j), 0.2),
      velocity: Math.min(1, 0.2 + 0.6 * speed) * (0.35 + 0.65 * R('nib', 'level', i * 100 + j)), vary: 0.7, pan: Sd.panX(x0 + (x1 - x0) * u), distance: far,
    })));
    tap(l.t1, x1, 900, 0.5, 'up');
  });
  // The carriage parks off the sheet, to the right.
  pairs.push([M.FINISH, { ...Sd.breath(420, 0.1, 0.5, 0.05), sweep: [[0, 300], [0.25, 800], [0.5, 260]], velocity: 0.7, pan: 0.7, distance: 0.4 }]);
  Sd.mix(ctx, R, Sd.place(ctx, R, 'pen', pairs, end), { level: 6 });
}

/**
 * While the shot is scrolled: a dry sheet in a quiet room. A fibre ticks
 * here and there as the ink dries, the sheet settles with a soft low tap,
 * and at times a slow dark breath of the room, far off.
 */
sound.ambience = Sd.ambience('paper air', (R, loop) => [
  ...Sd.scatter(R, 'fibre', loop, 0.7, (j, swell) => ({
    ...Sd.snap(2200 + 3000 * R('fibre', 'colour', j), 0.002 + 0.004 * R('fibre', 'length', j), 0.1),
    velocity: swell * (0.15 + 0.85 * R('fibre', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('fibre', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('fibre', 'far', j),
  })),
  ...Sd.scatter(R, 'sheet', loop, 2.6, (j, swell) => ({
    ...Sd.snap(260 + 300 * R('sheet', 'colour', j), 0.03 + 0.03 * R('sheet', 'length', j), 0.22),
    velocity: swell * (0.3 + 0.7 * R('sheet', 'level', j)), vary: 0.6, pan: 1.4 * (R('sheet', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('sheet', 'far', j),
  })),
  ...Sd.scatter(R, 'room', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'room ' + j, at, 1.6, (u) => (180 + 120 * R('room', 'colour', j)) * (1 + 1.1 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('room', 'level', j))),
    { pan: 1.2 * (R('room', 'pan', j) - 0.5), distance: 0.5 })),
], { level: 2 });

module.exports = { ...require('./intro.cjs'), name: 'site-intro-heard', sound };
