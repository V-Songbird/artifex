// A two-second film with no imports, so a test can copy it to a folder of its
// own and find the strips npm run seeds writes beside it there: one disc
// crossing a grey ground. Used by tests/film-cli.test.js for the looks a saved
// film lists. Never show it to anyone.

'use strict';

module.exports = {
  name: 'looks-film',
  size: { w: 320, h: 180 },
  // So a film along a box timeline can name it in the commands it prints.
  boxes: { w: [180, 320], h: [180, 320] },
  seed: 1,
  time: { duration: 2, hz: 12 },
  draw(g, s, t) {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = '#204060';
    g.beginPath();
    g.arc(40 + 240 * t, 90, 30, 0, Math.PI * 2);
    g.fill();
  },
};
