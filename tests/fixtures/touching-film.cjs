// A film whose state keeps contact lists, for the contact strip's tests in
// tests/contact-sheet.test.js: cues.contacts has two contacts on frame 3 and
// one at 1 s, the first two at a point; the other lists are cut short by the
// film's ends, broken or pointed only on a later entry. Its two squares swap
// paint order on odd frames, for the paint-order reader.

'use strict';

module.exports = {
  name: 'touching', size: { w: 960, h: 640 }, seed: 1, time: { duration: 2, hz: 12 },
  build: [['plan', (s) => {
    s.cues = { contacts: [{ frame: 3, x: 100, y: 100 }, { seconds: 1, x: 900, y: 600 }, { frame: 3 }], shots: [{ name: 'one', start: 0, end: 24 }] };
    s.broken = [{ frame: 3 }, { at: 2 }];
    s.late = [{ frame: 23 }];
    s.ends = [{ frame: 0 }, { frame: 10 }, { frame: 23 }];
    s.pointed = [{ frame: 5 }, { frame: 5, x: 900, y: 600 }];
  }]],
  draw(g, s, t, clock) {
    const square = (colour, x) => { g.fillStyle = colour; g.fillRect(x, 100, 200, 200); };
    const order = clock.frame % 2 ? ['#00f', '#f00'] : ['#f00', '#00f'];
    square(order[0], 100); square(order[1], 200);
    g.fillStyle = '#0f0'; g.fillRect(600, 100, 100, 100);
  },
};
