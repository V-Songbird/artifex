'use strict';

// A fixture pack's mark functions for the gallery tests: round dots along a path.

/** A filled dot of radius r at (x, y). */
function dot(g, x, y, r, colour) {
  g.fillStyle = colour;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Dots of radius r every `step` units along the polyline `points`. */
function dotted(g, points, r, step, colour) {
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) dot(g, ax + (bx - ax) * k / n, ay + (by - ay) * k / n, r, colour);
  }
}

module.exports = { dot, dotted };
