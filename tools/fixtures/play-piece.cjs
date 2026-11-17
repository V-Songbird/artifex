// An interactive piece for proving sessions in a browser: the page's play
// mode, a saved session run again tick by tick, and the film and still made
// from it, replayed. A press drops a mark where it lands, its colour from the
// seed; the arrow keys move a square cursor one cell, and Enter or Space drops
// a mark there; a hand sweeps round the middle all the time, so every frame
// differs from its neighbours. Never show it to anyone.

'use strict';

const W = 160;
const H = 120;
const CELL = 20;
const MOVES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function drop(s, x, y, tick, R) {
  s.marks.push({ x, y, tick, hue: Math.floor(R('mark', 'hue', s.marks.length) * 360) });
}

module.exports = {
  name: 'play-piece',
  size: { w: W, h: H },
  seed: 1,
  params: { reach: { min: 4, max: 20, value: 10, meaning: 'radius each dropped mark grows to, in design units' } },
  state: () => ({ marks: [], cursor: { x: 3, y: 2 }, pointer: null }),
  play: {
    step(s, inputs, tick, R) {
      for (const e of inputs) {
        if (e.kind !== 'key') s.pointer = { x: e.x, y: e.y };
        if (e.kind === 'down') drop(s, e.x, e.y, tick, R);
        if (e.kind !== 'key' || !e.down) continue;
        const move = MOVES[e.key];
        if (move) {
          s.cursor.x = Math.min(W / CELL - 1, Math.max(0, s.cursor.x + move[0]));
          s.cursor.y = Math.min(H / CELL - 1, Math.max(0, s.cursor.y + move[1]));
        }
        if (e.key === 'Enter' || e.key === ' ') drop(s, (s.cursor.x + 0.5) * CELL, (s.cursor.y + 0.5) * CELL, tick, R);
      }
    },
    describe: (s) => `${s.marks.length} marks; the cursor is in column ${s.cursor.x + 1}, row ${s.cursor.y + 1}.`,
  },
  draw(g, s, t, clock) {
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#333333';
    g.lineWidth = 2;
    g.strokeRect(s.cursor.x * CELL + 1, s.cursor.y * CELL + 1, CELL - 2, CELL - 2);
    for (const m of s.marks) {
      // A mark grows over a third of a second from the tick it was dropped on.
      const r = s.params.reach * Math.min(1, Math.max(0, (clock.tick - m.tick + 1) / 20));
      g.fillStyle = `hsl(${m.hue}, 60%, 45%)`;
      g.beginPath();
      g.arc(m.x, m.y, r, 0, Math.PI * 2);
      g.fill();
    }
    const a = t * Math.PI;
    g.strokeStyle = '#1f4e79';
    g.beginPath();
    g.moveTo(W / 2, H / 2);
    g.lineTo(W / 2 + Math.cos(a) * 40, H / 2 + Math.sin(a) * 40);
    g.stroke();
    if (s.pointer) {
      g.fillStyle = '#b03a2e';
      g.fillRect(s.pointer.x - 2, s.pointer.y - 2, 4, 4);
    }
  },
};
