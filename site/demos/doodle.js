// The showcase site's demo of Doodle: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/doodle.js. Site-only, never
// a starting point for a piece. The bird sits on a branch in the middle of a
// notebook page, singing, with the doodles a bored hand makes around it:
// bubble letters over a highlighter swipe, stars, a spiral, a hatched cube,
// a sun, notes. The seed picks the pen, the highlighter, the bird's tilt and
// where the small stars sit, and mirrors the drawing on about half the pages;
// on a mirrored page, words and notes keep reading the right way, and the
// title and the sun stay in place.

'use strict';

const { rng } = require('../../core/rand.js');
const { chaikin } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, ellipse, caption } = require('../../skills/artifex/styles/kit.js');
const marks = require('../../skills/artifex/styles/doodle.js');

const { PAPER, BLUE, INKS, RED, MARKERS, page, highlight, bubble, write } = marks;
const W = 1000; const H = 1000;
// INK is the pen of the page being drawn and PASSES how often a hand goes
// over a line; the scene's pen defaults to both and its hatching to INK.
let INK = BLUE;
let PASSES = 2;
const pen = (g, R, name, pts, close = false, ink = INK, width = 2.6, passes = PASSES) => marks.pen(g, R, name, pts, { close, ink, width, passes });
const hatch = (g, R, name, region, angle, spacing, ink = INK) => marks.hatch(g, R, name, region, { angle, spacing, ink });

function starPath(cx, cy, r, rot = -Math.PI / 2) {
  const pts = [];
  for (let k = 0; k <= 5; k++) {
    const a = rot + (k * 4 * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function heart(cx, cy, s) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    pts.push([cx + 16 * Math.sin(t) ** 3 * s, cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * s]);
  }
  return pts;
}

function note(g, R, name, x, y, size) {
  const head = ellipse(x, y, size * 0.32, size * 0.22, 20, -0.45);
  g.fillStyle = INK;
  path(g, head);
  g.fill();
  pen(g, R, name + 's', [[x + size * 0.28, y - size * 0.05], [x + size * 0.3, y - size * 1.2]]);
  pen(g, R, name + 'f', chaikin([[x + size * 0.3, y - size * 1.2], [x + size * 0.72, y - size * 0.92], [x + size * 0.6, y - size * 0.55]], 2));
}

function draw(g, s) {
  const R = rng(s.seed);
  INK = INKS[Math.floor(R('look', 'ink') * INKS.length)];
  PASSES = Math.round((s.params && s.params.passes) ?? 2);
  // Half the seeds mirror the drawing about x = 550, which keeps it between
  // the margin and the edge; words are drawn unmirrored at their mirrored place.
  const flip = R('look', 'face') >= 0.5;
  const words = (str, x, y, size, rot = 0) => write(g, str, x, y, size, { ink: INK, rot, mirror: flip });

  // Notebook page.
  page(g, R, W, H, { holes: [190, 500, 810] });

  // Bubble letters over a highlighter swipe.
  highlight(g, R, 'hl', [[300, 112], [740, 102]], MARKERS[Math.floor(R('look', 'marker') * MARKERS.length)]);
  const word = 'ARTIFEX'; const size = 76; const x0 = 520 - font.width(word, size) / 2;
  bubble(g, word, x0, 72, size, { ink: INK, weight: 30, inner: 24, depth: 5 });

  // A sun beside the title, never mirrored, so it stays clear of the letters.
  const sun = [860, 130];
  pen(g, R, 'sun', ellipse(sun[0], sun[1], 38, 38, 32), true);
  const rays = [];
  for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; const r = k % 2 ? 50 : 72; rays.push([sun[0] + Math.cos(a) * r, sun[1] + Math.sin(a) * r]); }
  pen(g, R, 'rays', rays, true, INK, 2.2, 1);
  g.fillStyle = INK;
  for (const dx of [-12, 12]) { g.beginPath(); g.arc(sun[0] + dx, sun[1] - 8, 4, 0, Math.PI * 2); g.fill(); }
  const smile = []; for (let i = 0; i <= 8; i++) { const a = 0.3 + (i / 8) * (Math.PI - 0.6); smile.push([sun[0] + Math.cos(a) * 18, sun[1] + 2 + Math.sin(a) * 14]); }
  pen(g, R, 'smile', smile, false, INK, 2.4, 1);

  // The bird on a branch, its head tilted as the seed says.
  g.save();
  if (flip) { g.translate(1100, 0); g.scale(-1, 1); }
  const b = bird(440, 520, 215, -0.04 + (R('look', 'tilt') - 0.5) * 0.2);
  const branch = chaikin([[150, 690], [330, 672], [520, 668], [700, 650], [820, 628]], 2);
  pen(g, R, 'branch', branch, false, INK, 3.4);
  pen(g, R, 'branch2', branch.map(([x, y]) => [x + 6, y + 12]), false, INK, 2.2, 1);
  for (const [i, [x, y, a]] of [[200, 684, -0.6], [610, 660, 0.5], [760, 640, -0.5]].entries()) {
    const leaf = ellipse(x, y - 14, 22, 9, 16, a);
    pen(g, R, 'leaf' + i, leaf, true, INK, 2.2);
    hatch(g, R, 'leafh' + i, leaf, a + 1.2, 7);
  }
  for (const [i, leg] of b.legs.entries()) pen(g, R, 'leg' + i, [leg[0], [leg[1][0], 668]], false, INK, 3);
  pen(g, R, 'tail', b.tail, true);
  hatch(g, R, 'tailh', b.tail, 0.9, 9);
  pen(g, R, 'body', b.body, true);
  g.save();
  path(g, b.body);
  g.clip();
  const shade = b.at(ellipse(-0.1, 0.36, 0.7, 0.3));
  hatch(g, R, 'belly', shade, 0.7, 10);
  hatch(g, R, 'belly2', b.at(ellipse(-0.3, 0.42, 0.45, 0.16)), -0.7, 10);
  g.restore();
  g.fillStyle = PAPER;
  path(g, b.wing);
  g.fill();
  pen(g, R, 'wing', b.wing, true);
  for (let k = 0; k < 4; k++) {
    const arc = b.at([[0.12 - k * 0.2, -0.04], [0.02 - k * 0.2, 0.06], [-0.1 - k * 0.2, -0.02]]);
    pen(g, R, 'scallop' + k, chaikin(arc, 2), false, INK, 2);
  }
  g.fillStyle = PAPER;
  path(g, b.beak);
  g.fill();
  pen(g, R, 'beak', b.beak, true);
  g.fillStyle = INK;
  g.beginPath(); g.arc(b.eye[0], b.eye[1], 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = PAPER;
  g.beginPath(); g.arc(b.eye[0] + 3.5, b.eye[1] - 3.5, 3.5, 0, Math.PI * 2); g.fill();
  pen(g, R, 'cheek', ellipse(b.cheek[0] + 4, b.cheek[1] + 6, 14, 9), true, RED, 2);

  // What it sings.
  const beak = b.at([[1.03, -0.34]])[0];
  for (let k = 1; k <= 3; k++) {
    const arc = [];
    for (let i = 0; i <= 8; i++) { const a = -0.55 + (i / 8) * 1.1; arc.push([beak[0] + 6 + Math.cos(a) * k * 20, beak[1] + Math.sin(a) * k * 20]); }
    pen(g, R, 'wave' + k, arc, false, INK, 2, 1);
  }
  // Notes, like words, are drawn unmirrored at their mirrored place.
  for (const [name, x, y, size] of [['n1', 760, 380, 60], ['n2', 860, 300, 46]]) {
    g.save();
    g.translate(x, y);
    if (flip) g.scale(-1, 1);
    note(g, R, name, 0, 0, size);
    g.restore();
  }
  words('TWEET!', 700, 250, 26, -0.12);

  // The margins fill up.
  const cloud = [];
  for (const [cx, cy, r, a0, a1] of [[200, 320, 26, Math.PI * 0.9, Math.PI * 1.9], [240, 300, 32, Math.PI * 1.1, Math.PI * 1.95], [282, 318, 24, Math.PI * 1.3, Math.PI * 2.3]]) {
    for (let i = 0; i <= 8; i++) { const a = a0 + ((a1 - a0) * i) / 8; cloud.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  }
  cloud.push([286, 342], [196, 342]);
  pen(g, R, 'cloud', cloud, true);
  for (let i = 0; i < 6; i++) pen(g, R, 'rain' + i, [[200 + i * 16, 356], [192 + i * 16, 376]], false, INK, 2, 1);

  for (const [i, [x, y, r]] of [[180, 230, 20], [720, 560, 16], [560, 870, 24], [930, 420, 14], [420, 210, 12]].entries()) {
    const [dx, dy0] = [(R('star', 'x', i) - 0.5) * 50, (R('star', 'y', i) - 0.5) * 50];
    // On a mirrored page the first star lands under the sun, so it only drops, keeping its tips 14 px clear of the rays.
    const dy = flip && i === 0 ? Math.abs(dy0) : dy0;
    pen(g, R, 'star' + i, starPath(x + dx, y + dy, r, -Math.PI / 2 + (R('star', 'turn', i) - 0.5)), false, INK, 2.2, 1);
  }
  for (const [i, [x, y]] of [[640, 210], [300, 780], [930, 560]].entries()) {
    pen(g, R, 'plus' + i, [[x - 9, y], [x + 9, y]], false, INK, 2, 1);
    pen(g, R, 'plusv' + i, [[x, y - 9], [x, y + 9]], false, INK, 2, 1);
  }
  pen(g, R, 'heart1', heart(318, 220, 1.3), true, RED, 2.6);
  pen(g, R, 'heart2', heart(905, 680, 1.1), true, RED, 2.4);

  const spiral = [];
  for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 7; const r = 3 + a * 4.2; spiral.push([230 + Math.cos(a) * r, 860 + Math.sin(a) * r]); }
  pen(g, R, 'spiral', spiral, false, INK, 2.4, 1);

  const cube = [[770, 780], [850, 780], [850, 860], [770, 860]];
  const back = cube.map(([x, y]) => [x + 36, y - 30]);
  pen(g, R, 'cubeF', cube, true);
  pen(g, R, 'cubeB', back, true, INK, 2, 1);
  for (let k = 0; k < 4; k++) pen(g, R, 'cubeE' + k, [cube[k], back[k]], false, INK, 2, 1);
  hatch(g, R, 'cubeS', [cube[1], back[1], back[2], cube[2]], 1.1, 8);

  const bolt = [[630, 760], [668, 760], [648, 800], [678, 800], [616, 872], [636, 818], [606, 818]];
  pen(g, R, 'bolt', bolt, true);
  hatch(g, R, 'bolth', bolt, -0.8, 7);

  const arrow = chaikin([[170, 760], [210, 700], [290, 680], [330, 640]], 3);
  pen(g, R, 'arrow', arrow, false, INK, 2.4, 1);
  pen(g, R, 'arrowA', [[304, 638], [330, 640], [318, 664]], false, INK, 2.4, 1);
  words('ME!', 136, 770, 22);

  const squiggle = [];
  for (let i = 0; i <= 60; i++) squiggle.push([380 + i * 6, 940 + Math.sin(i * 0.9) * 8]);
  pen(g, R, 'squiggle', squiggle, false, INK, 2.2, 1);
  g.restore();

  caption(g, 'DOODLE', font, INK, 128, 952, 14);
}

module.exports = {
  name: 'doodle', size: { w: 1000, h: 1000 }, seed: 2026,
  params: { passes: { min: 1, max: 6, value: 2, meaning: 'How many times the pen goes over each main line: 1 draws clean single strokes, 6 a heavy, scribbled line' } },
  draw,
};
