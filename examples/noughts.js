// noughts -- a game of noughts and crosses doodled in ballpoint on a folded
// sheet, against a pencilled sun in the margin who answers each move.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other example is
// a still or a film: its picture is fixed by the seed and the playhead. Here
// the picture is whatever the player made of it. The piece declares `play`:
// `step` is the only code that changes the state after the build, one tick at
// a time, handed the presses and keys that landed in that tick; `draw` only
// looks. So the input log is the whole game: the page saves it as a session,
// and the film, the still and the replay of that session come from it.
//
// THE MARGIN ANSWERS. A mark is a pen stroke that grows over a third of a
// second and scratches as it goes; the sun watches the pointer, closes its eyes
// while it thinks, giggles when it is poked, and the line through three is
// drawn with a chord. Every reaction is planned as a contact is in a film: the
// thing touched reacts, and the reaction carries a sound. The arrow keys move
// a pencilled cursor, Enter or Space marks under it, and describe() says the
// board in words for a screen reader. Under reduced motion the sun stops
// turning; the marks still grow, since they are the game.

'use strict';

const { rng } = require('../core/rand.js');
const { layer } = require('../core/layer.js');
const { hertz } = require('../core/sound.js');
const ink = require('../skills/artifex/styles/pen-and-pencil.js');

const W = 720;
const H = 480;
// The board: three cells a side of C, its corner at (BX, BY).
const BX = 70;
const BY = 60;
const C = 120;
// The sun in the margin, its centre and radius.
const SX = 578;
const SY = 168;
const SR = 58;
// Ticks a mark takes to draw, the sun takes to reply, and a reaction lasts.
const GROW = 20;
const REPLY = 36;
const REACT = 40;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const MOVES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const ROWS = ['top', 'middle', 'bottom'];
const COLS = ['left', 'centre', 'right'];

// The sounds, as cues for core/play.js: a pen's scratch, the sun's giggle and
// three plucks that rise for the player's line and fall for the sun's.
const scratch = (tick, name, long = 0.3) => ({
  tick, name, wet: 0.12,
  // Low in the mix: the scratch is detail, and the chord that ends a round must stand over it.
  shaker: { length: long, rate: [[0, 1100], [long, 400]], ring: 0.003, energy: [[0, 1], [long, 0.25]], modes: [[2700, 0.005, 1], [5100, 0.003, 0.5]], level: 0.22 },
});
const giggle = (tick, k) => ({
  tick, name: 'giggle ' + k, wet: 0.3,
  voice: { pitch: 560 + 70 * k, partials: [[1, 1], [2, 0.25]], decay: 0.22, bend: [[0, -120], [0.12, 160]], vibrato: { depth: 45, rate: 11 }, level: 0.35, strike: { level: 0 } },
});
const chord = (tick, notes, name) => notes.map((n, i) => ({ tick: tick + 8 * i, name: name + ' ' + i, wet: 0.35, pluck: { pitch: hertz(n), decay: 1.4, level: 0.55 } }));

const winner = (board) => LINES.find((l) => board[l[0]] && board[l[0]] === board[l[1]] && board[l[0]] === board[l[2]]) || null;

function mark(s, cell, who, tick) {
  s.board[cell] = who;
  s.marks.push({ cell, who, tick });
  const n = s.marks.length;
  s.cues.sounds.push(scratch(tick, 'scratch ' + s.round + ' ' + n));
  if (who === 'x') s.cues.sounds.push(scratch(tick + GROW / 2, 'cross ' + s.round + ' ' + n));
  const line = winner(s.board);
  if (line || s.marks.length === 9) {
    s.result = { winner: line ? who : null, line, tick: tick + GROW };
    if (line) s.score[who]++;
    s.cues.sounds.push(...(line ? chord(tick + GROW, who === 'x' ? [72, 76, 79] : [67, 63, 60], 'line ' + s.round) : [scratch(tick + GROW, 'draw ' + s.round, 0.5)]));
    if (line) s.cues.sounds.push(scratch(tick + GROW, 'strike ' + s.round, 0.4));
    return;
  }
  s.turn = who === 'x' ? 'o' : 'x';
  if (s.turn === 'o') s.replyAt = tick + REPLY;
}

// The sun's move: a line of its own if it has one, mostly a block, the centre
// often, else any free cell, all from the seeded source.
function reply(s, R) {
  const free = s.board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const k = s.round * 9 + s.marks.length;
  const finishing = (who) => free.find((i) => winner(s.board.map((v, j) => (j === i ? who : v))));
  const win = finishing('o');
  if (win !== undefined) return win;
  const block = finishing('x');
  if (block !== undefined && R('reply', 'block', k) < 0.8) return block;
  if (!s.board[4] && R('reply', 'centre', k) < 0.6) return 4;
  return free[Math.floor(R('reply', 'pick', k) * free.length)];
}

function newRound(s) {
  s.round++;
  Object.assign(s, { board: Array(9).fill(null), marks: [], turn: 'x', result: null, replyAt: null });
}

module.exports = {
  name: 'noughts',
  size: { w: W, h: H },
  seed: 4,
  outputs: ['raster'],
  state: () => ({ cues: { sounds: [] } }),
  build: [
    ['set the board', (s) => {
      Object.assign(s, { round: 0, score: { x: 0, o: 0 }, cursor: 4, keys: false, pointer: null, poked: null });
      newRound(s);
    }],
  ],
  play: {
    step(s, inputs, tick, R) {
      for (const e of inputs) {
        if (e.kind !== 'key') { s.pointer = { x: e.x, y: e.y }; s.keys = false; }
        if (e.kind === 'key' && !e.down) continue;
        if (e.kind === 'key') {
          s.keys = true;
          const move = MOVES[e.key];
          if (move) s.cursor = Math.min(2, Math.max(0, (s.cursor % 3) + move[0])) + 3 * Math.min(2, Math.max(0, Math.floor(s.cursor / 3) + move[1]));
          if (e.key !== 'Enter' && e.key !== ' ') continue;
        } else if (e.kind !== 'down') continue;
        if (e.kind === 'down' && Math.hypot(e.x - SX, e.y - SY) < SR + 30) {
          s.poked = tick;
          s.cues.sounds.push(giggle(tick, 0), giggle(tick + 7, 1));
          continue;
        }
        if (s.result) { if (tick >= s.result.tick + 30) newRound(s); continue; }
        const col = e.kind === 'key' ? s.cursor % 3 : Math.floor((e.x - BX) / C);
        const row = e.kind === 'key' ? Math.floor(s.cursor / 3) : Math.floor((e.y - BY) / C);
        if (col < 0 || col > 2 || row < 0 || row > 2 || s.turn !== 'x' || s.board[row * 3 + col]) continue;
        s.cursor = row * 3 + col;
        mark(s, row * 3 + col, 'x', tick);
      }
      if (s.turn === 'o' && !s.result && tick >= s.replyAt) mark(s, reply(s, R), 'o', tick);
    },
    describe(s) {
      const cells = ROWS.map((r, i) => r + ' row ' + [0, 1, 2].map((j) => ({ x: 'cross', o: 'nought' }[s.board[i * 3 + j]] || 'empty')).join(', ')).join('; ');
      const said = s.result ? (s.result.winner === 'x' ? 'You won this round' : s.result.winner ? 'The sun won this round' : 'A draw') + '; press or Enter to play again'
        : s.turn === 'x' ? 'Your turn, you are crosses' : 'The sun is thinking';
      const at = s.keys ? ` The cursor is on the ${ROWS[Math.floor(s.cursor / 3)]} row, ${COLS[s.cursor % 3]}.` : '';
      return `${said}. You ${s.score.x}, the sun ${s.score.o}. ${cells}.${at}`;
    },
  },
  draw(g, s, t, clock) {
    const R = rng(s.seed);
    const now = t * clock.hz;
    // The sheet, the grid and the sun's pencilled face never change: kept as one layer.
    layer(g, s, 'sheet', [0, 0, W, H], (gg, st) => {
      const Rs = rng(st.seed);
      ink.paper(gg, Rs, W, H);
      for (let k = 1; k <= 2; k++) {
        ink.pen(gg, Rs, 'grid v' + k, [[BX + k * C, BY - 12], [BX + k * C, BY + 3 * C + 10]], { w: 3 });
        ink.pen(gg, Rs, 'grid h' + k, [[BX - 12, BY + k * C], [BX + 3 * C + 10, BY + k * C]], { w: 3 });
      }
      const disc = Array.from({ length: 40 }, (_, i) => [SX + Math.cos((i / 40) * Math.PI * 2) * SR, SY + Math.sin((i / 40) * Math.PI * 2) * SR]);
      ink.pencil(gg, Rs, 'sun', disc, ink.PENCIL.yellow, { tone: 0.55, cross: true });
    });
    // The marks, each drawn over GROW ticks from the tick it was made.
    for (const m of s.marks) {
      const p = Math.max(0, Math.min(1, (now - m.tick) / GROW));
      const cx = BX + (m.cell % 3 + 0.5) * C;
      const cy = BY + (Math.floor(m.cell / 3) + 0.5) * C;
      const id = s.round + ' ' + m.cell;
      if (m.who === 'x') {
        const d = C * 0.3;
        const strokes = [[[cx - d, cy - d], [cx + d, cy + d]], [[cx + d, cy - d], [cx - d, cy + d]]];
        strokes.forEach(([a, b], i) => {
          const q = Math.max(0, Math.min(1, p * 2 - i));
          if (q > 0.05) ink.pen(g, R, 'x' + i + ' ' + id, [a, [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]], { ink: 'blue', w: 4 });
        });
      } else if (p > 0.05) {
        const start = -1.2 + R('o', 'start', m.cell) * 0.6;
        const n = Math.max(2, Math.round(p * 44));
        const loop = Array.from({ length: n }, (_, i) => {
          const a = start + (i / 40) * Math.PI * 2;
          return [cx + Math.cos(a) * C * 0.31, cy + Math.sin(a) * C * 0.34];
        });
        ink.pen(g, R, 'o ' + id, loop, { ink: 'red', w: 4 });
      }
    }
    if (s.result && s.result.line) {
      const p = Math.max(0, Math.min(1, (now - s.result.tick) / 24));
      const at = (cell) => [BX + (cell % 3 + 0.5) * C, BY + (Math.floor(cell / 3) + 0.5) * C];
      const [a0, b0] = [at(s.result.line[0]), at(s.result.line[2])];
      const [dx, dy] = [(b0[0] - a0[0]) * 0.18, (b0[1] - a0[1]) * 0.18];
      const a = [a0[0] - dx, a0[1] - dy];
      const b = [b0[0] + dx, b0[1] + dy];
      if (p > 0.05) ink.pen(g, R, 'line ' + s.round, [a, [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p]], { w: 6, tone: 0.9 });
    }
    // The focus mark, drawn while the keys are in use.
    if (s.keys && !s.result) {
      const x = BX + (s.cursor % 3) * C + 10;
      const y = BY + Math.floor(s.cursor / 3) * C + 10;
      ink.pen(g, R, 'cursor', [[x, y], [x + C - 20, y], [x + C - 20, y + C - 20], [x, y + C - 20]], { close: true, w: 1.6, tone: 0.45, wob: 1.6 });
    }
    // The sun: rays that turn slowly, a face that watches the pointer and reacts.
    const spin = clock.reducedMotion ? 0 : t * 0.35;
    const poked = s.poked !== null && now - s.poked < REACT;
    const bob = poked && !clock.reducedMotion ? Math.sin(((now - s.poked) / REACT) * Math.PI * 4) * 4 : 0;
    for (let i = 0; i < 11; i++) {
      const a = spin + (i / 11) * Math.PI * 2;
      ink.pen(g, R, 'ray ' + i, [[SX + Math.cos(a) * (SR + 10), SY + Math.sin(a) * (SR + 10)], [SX + Math.cos(a) * (SR + 28), SY + Math.sin(a) * (SR + 28)]], { w: 2.4 });
    }
    const ring = Array.from({ length: 40 }, (_, i) => [SX + Math.cos((i / 40) * Math.PI * 2) * SR, SY + Math.sin((i / 40) * Math.PI * 2) * SR]);
    ink.pen(g, R, 'sun ring', ring, { close: true, w: 2.6 });
    const look = s.pointer ? [s.pointer.x - SX, s.pointer.y - SY] : [0, 0];
    const far = Math.hypot(look[0], look[1]) || 1;
    const lean = Math.min(9, far * 0.05);
    const mood = poked ? 'cat'
      : s.result ? (s.result.winner === 'o' ? 'happy' : s.result.winner === 'x' ? 'oh' : 'flat')
        : s.turn === 'o' ? 'sleep' : 'happy';
    ink.face(g, R, 'sun face', SX + (look[0] / far) * lean, SY + bob + (look[1] / far) * lean - 4, SR * 1.5, mood);
    // The score and what happens next, in the same pen.
    ink.letter(g, R, 'score ' + s.score.x + ' ' + s.score.o, 'you ' + s.score.x + '  sun ' + s.score.o, 488, 300, 22, ['blue', 'red']);
    const hint = s.result ? 'press to play again' : s.turn === 'x' ? 'your turn' : 'thinking';
    ink.letter(g, R, 'hint ' + hint, hint, 488, 350, 14, ['brown'], 1.6);
  },
};
