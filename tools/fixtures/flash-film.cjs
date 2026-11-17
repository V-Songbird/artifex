// A film that flashes on purpose, for proving the export's flash count
// (core/flash.js) in a browser: in its first second a lamp over a third of the
// frame switches between white and near-black 4 times a second, a general
// flash; in its second a dim red panel, too dark to flash in brightness,
// switches on and off 5 times a second, a red flash; and all through, a small
// dot, under the area rule, blinks 6 times a second. A bar crosses the frame
// the whole time, so something moves to the end. Never show it to anyone.

'use strict';

const W = 960;
const H = 540;
const HZ = 24;
// Whole cycles a second of each flasher, from the frame's own count.
const on = (frame, rate) => Math.floor((frame * 2 * rate) / HZ) % 2 === 1;

module.exports = {
  name: 'flash-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 3, hz: HZ },
  draw(g, s, t, clock) {
    const second = Math.floor(clock.frame / HZ);
    g.fillStyle = '#202020';
    g.fillRect(0, 0, W, H);
    if (second === 0) {
      g.fillStyle = on(clock.frame, 4) ? '#ffffff' : '#101010';
      g.fillRect(60, 60, 480, 360);
    }
    if (second === 1) {
      g.fillStyle = on(clock.frame, 5) ? '#5a0000' : '#000000';
      g.fillRect(420, 120, 480, 360);
    }
    g.fillStyle = on(clock.frame, 6) ? '#ffffff' : '#202020';
    g.fillRect(880, 40, 24, 24);
    g.fillStyle = '#707070';
    g.fillRect(t * (W - 40), H - 50, 40, 20);
  },
};
