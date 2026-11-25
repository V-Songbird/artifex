'use strict';

module.exports = {
  dot: { box: [0, 0, 20, 20], draw(g, marks) { marks.dot(g, 10, 10, 6, '#223'); } },
  dotted: { box: [0, 0, 60, 20], draw(g, marks) { marks.dotted(g, [[8, 10], [52, 10]], 4, 10, '#223'); } },
};
