// Sumi-e: black ink on rice paper, in few strokes and much empty space. A
// stroke is a brush of bristles pressed and lifted along a path: solid where
// the brush is wet, breaking into streaks of bare paper where it runs dry,
// and bleeding a soft halo into the paper where the ink is thin. One brush
// carries every tone from pale wash to black.

'use strict';

const { rng, fbm } = require('../../../core/rand.js');
const { chaikin, resample } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, ellipse, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const INK = [22, 19, 17];
const PAPER = '#f1eadb';
const ink = (a) => 'rgba(' + INK.join(', ') + ', ' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';

// Pressure over a stroke's length. Every stroke enters with the tip turned
// back into the hair, so it starts round, not pointed.
const PRESS = {
  swell: (t) => 0.55 + 0.45 * Math.sin(Math.PI * t),
  taper: (t) => (0.8 + 0.2 * Math.min(1, t * 5)) * (1 - t) ** 0.7,
  blunt: (t) => 0.85 + 0.15 * Math.sin(Math.PI * t),
  press: (t) => (t < 0.25 ? 0.5 + 2 * t : 1) * (1 - 0.6 * t ** 3),
};

// One brush stroke along `spine`. `tone` is the ink's darkness, `dry` how
// much of the stroke the brush runs dry for (0 never), `grade` how much
// paler one side of the brush was loaded, `bleed` how far thin ink creeps
// into the paper.
function brush(g, R, name, spine, opts = {}) {
  const { w = 20, tone = 0.9, dry = 0.3, grade = 0.3, bleed = 0, press = PRESS.swell, bristles = 34 } = opts;
  const pts = resample(spine.length > 2 ? chaikin(spine, 3) : spine, 2);
  const n = pts.length;
  if (n < 2) return;
  const normal = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  });
  const half = pts.map((p, i) => (w / 2) * press(i / (n - 1)));
  const at = (i, side) => {
    const wob = 1 + 0.14 * (fbm(R, i * 0.04, side * 7.1, 2, name + 'edge') - 0.5);
    return [pts[i][0] + normal[i][0] * half[i] * side * wob, pts[i][1] + normal[i][1] * half[i] * side * wob];
  };
  // The wet body: solid until the brush starts to give out, where it ends
  // raggedly, some hairs holding ink further than others.
  const wetEnd = Math.max(2, Math.round(n * (1 - dry)));
  const body = [];
  for (let i = 0; i < wetEnd; i++) body.push(at(i, 1));
  for (let k = 0; k <= 8; k++) {
    const side = 1 - k / 4;
    const reach = Math.min(n - 1, wetEnd - 1 + Math.round(R(name, 'reach', k) * Math.min(24, (n - wetEnd) * 0.8)));
    body.push([pts[reach][0] + normal[reach][0] * half[reach] * side, pts[reach][1] + normal[reach][1] * half[reach] * side]);
  }
  for (let i = wetEnd - 1; i >= 0; i--) body.push(at(i, -1));
  // The start: the round of the pressed tip, behind the first point.
  const back = Math.atan2(normal[0][1], normal[0][0]);
  for (let k = 1; k < 8; k++) {
    const a = back + Math.PI - (k / 8) * Math.PI;
    body.push([pts[0][0] + Math.cos(a) * half[0], pts[0][1] + Math.sin(a) * half[0]]);
  }
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (bleed > 0) {
    // Thin ink feathers into the fibres round the stroke.
    g.strokeStyle = ink(tone * 0.06);
    for (let k = 1; k <= 4; k++) {
      g.lineWidth = bleed * k * 1.5;
      path(g, body);
      g.stroke();
    }
  }
  g.fillStyle = ink(tone * (0.8 - 0.3 * grade));
  path(g, body);
  g.fill();
  // Bristles: each runs dry at its own point, then skips, leaving streaks
  // of bare paper that grow toward the end of the stroke.
  for (let j = 0; j < bristles; j++) {
    const side = -1 + (2 * (j + 0.5)) / bristles + (R(name, 'off', j) - 0.5) * (1.4 / bristles);
    const runs = 1 - dry * (0.15 + 0.85 * R(name, 'quit', j));
    g.strokeStyle = ink(tone * (0.5 - 0.35 * grade * (side + 1) / 2) * (0.7 + 0.5 * R(name, 'load', j)));
    g.lineWidth = Math.max(0.7, (w / bristles) * (0.9 + 1.2 * R(name, 'thick', j)));
    g.beginPath();
    let down = false;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const worn = t < runs ? 0 : (t - runs) / Math.max(0.05, 1 - runs);
      const on = fbm(R, i * 0.06, j * 1.9, 2, name + 'skip') > 0.25 + 0.5 * worn;
      const x = pts[i][0] + normal[i][0] * half[i] * side; const y = pts[i][1] + normal[i][1] * half[i] * side;
      if (on && half[i] > 0.4) {
        if (down) g.lineTo(x, y); else g.moveTo(x, y);
        down = true;
      } else down = false;
    }
    g.stroke();
  }
  g.restore();
}

function dot(g, x, y, r, tone) {
  g.fillStyle = ink(tone * 0.12);
  g.beginPath();
  g.arc(x, y, r * 1.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ink(tone);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// A plum blossom in outline: five round petals in a fine line over a pale
// wash, a dark calyx and stamens that end in dots.
function blossom(g, R, name, x, y, r, turn) {
  g.save();
  const petals = [];
  for (let k = 0; k < 5; k++) {
    const a = turn + (k / 5) * Math.PI * 2;
    petals.push([x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58, a]);
  }
  g.fillStyle = ink(0.045);
  for (const [px, py] of petals) {
    g.beginPath();
    g.arc(px, py, r * 0.52, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = PAPER;
  g.globalAlpha = 0.55;
  g.beginPath();
  g.arc(x, y, r * 0.5, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = ink(0.7);
  g.lineCap = 'round';
  for (const [k, [px, py, a]] of petals.entries()) {
    // Each petal is the outer part of a circle, broken where it meets the next.
    const from = a - 1.35 + (R(name, 'a', k) - 0.5) * 0.3;
    g.lineWidth = 1.3 + R(name, 'w', k);
    g.beginPath();
    g.arc(px, py, r * 0.52, from, from + 2.7 + R(name, 'b', k) * 0.3);
    g.stroke();
  }
  for (let k = 0; k < 7; k++) {
    const a = turn + k * 0.9 + R(name, 'sa', k) * 0.3;
    const l = r * (0.32 + 0.25 * R(name, 's', k));
    g.strokeStyle = ink(0.55);
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
    dot(g, x + Math.cos(a) * l, y + Math.sin(a) * l, 1.7, 0.9);
  }
  g.restore();
}

function draw(g, s) {
  const R = rng(s.seed);

  // Rice paper: warm, with light and dark fibres, darker toward its edges.
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  const shade = g.createRadialGradient(500, 470, 260, 500, 500, 760);
  shade.addColorStop(0, 'rgba(255, 252, 244, 0.25)');
  shade.addColorStop(1, 'rgba(150, 125, 85, 0.14)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    const x = R('fibre', 'x', i) * W; const y = R('fibre', 'y', i) * H;
    const a = R('fibre', 'a', i) * Math.PI * 2; const l = 6 + R('fibre', 'l', i) * 24; const bend = (R('fibre', 'b', i) - 0.5) * 10;
    g.strokeStyle = R('fibre', 't', i) < 0.6 ? 'rgba(255, 255, 250, 0.5)' : 'rgba(150, 130, 95, 0.16)';
    g.lineWidth = 0.6 + R('fibre', 'w', i) * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l / 2 + bend, y + Math.sin(a) * l / 2 - bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }

  // A pale night wash, laid wet so it has no edge, with the moon left as
  // bare paper.
  const moon = [262, 250, 92];
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.arc(moon[0], moon[1], moon[2], 0, Math.PI * 2);
  g.clip('evenodd');
  for (let k = 0; k < 36; k++) {
    const r = 110 + 250 * R('haze', 'r', k);
    const cx = moon[0] + 30 + (R('haze', 'cx', k) - 0.5) * 140; const cy = moon[1] + (R('haze', 'cy', k) - 0.5) * 110;
    const pts = ellipse(cx, cy, r * 1.3, r * 0.85, 48).map(([x, y], i) => [
      x + (fbm(R, i * 0.25, k * 1.7, 3, 'haze') - 0.5) * r * 0.5, y + (fbm(R, i * 0.25, k * 1.7 + 40, 3, 'haze') - 0.5) * r * 0.4,
    ]);
    g.fillStyle = ink(0.0075);
    path(g, pts);
    g.fill();
  }
  g.restore();
  g.strokeStyle = ink(0.05);
  for (let k = 1; k <= 3; k++) {
    g.lineWidth = k * 3;
    g.beginPath();
    g.arc(moon[0], moon[1], moon[2] + k, 0, Math.PI * 2);
    g.stroke();
  }

  // The plum: an old limb in one dry, heavy stroke, angular young twigs in
  // quick dark ones, knots where they leave the wood.
  const limb = [[10, 1000], [110, 900], [230, 820], [330, 742], [470, 688], [610, 650], [720, 624]];
  brush(g, R, 'limb', limb, { w: 62, tone: 0.95, dry: 0.4, grade: 0.65, press: PRESS.press, bristles: 56 });
  brush(g, R, 'limbhi', [[60, 960], [200, 850], [330, 760]], { w: 26, tone: 0.95, dry: 0.45, grade: 0.1, press: PRESS.blunt, bristles: 20 });
  const twigs = [
    [[700, 628], [800, 596], [880, 560], [990, 548]],
    [[330, 748], [318, 660], [270, 590], [262, 500]],
    [[800, 598], [826, 520], [818, 456]],
    [[880, 562], [912, 500], [958, 470]],
    [[270, 596], [216, 560], [180, 548]],
    [[470, 690], [520, 740], [590, 768]],
  ];
  twigs.forEach((t, i) => brush(g, R, 'twig' + i, t, { w: i === 0 ? 22 : 12, tone: 0.95, dry: 0.25, grade: 0.15, press: PRESS.taper, bristles: 16 }));
  for (const [x, y, r] of [[330, 748, 7], [470, 690, 6], [800, 598, 5], [880, 562, 5], [270, 596, 5], [150, 870, 8]]) dot(g, x, y - r * 0.8, r, 1);
  const flowers = [[262, 490, 30], [176, 540, 22], [818, 446, 28], [962, 462, 22], [896, 548, 18], [596, 770, 24], [304, 646, 20], [736, 586, 22]];
  flowers.forEach(([x, y, r], i) => blossom(g, R, 'fl' + i, x, y, r, R('fl', 'turn', i) * 6.3));
  for (const [x, y, r] of [[286, 560, 6], [830, 500, 5], [938, 492, 5], [210, 552, 4], [548, 750, 5], [990, 530, 4]]) dot(g, x, y, r, 0.9);

  // The subject in few strokes: a grey mass for the back, a black cap,
  // dry-brush wings and tail over them, and the belly left as paper with
  // one fine line.
  const b = bird(560, 452, 236, -0.08);
  const at = (pts) => b.at(pts);
  brush(g, R, 'back', at([[0.46, -0.5], [0.16, -0.4], [-0.16, -0.26], [-0.46, -0.08], [-0.6, 0.04]]), { w: 104, tone: 0.5, dry: 0.3, grade: 0.55, bleed: 3, press: PRESS.swell, bristles: 48 });
  brush(g, R, 'belly', at([[0.72, -0.2], [0.58, 0.12], [0.32, 0.38], [-0.04, 0.46], [-0.36, 0.34], [-0.56, 0.14]]), { w: 5, tone: 0.75, dry: 0.3, press: PRESS.taper, bristles: 6 });
  brush(g, R, 'head', at([[0.7, -0.36], [0.62, -0.56], [0.44, -0.64], [0.24, -0.56], [0.14, -0.44]]), { w: 76, tone: 0.97, dry: 0.2, grade: 0.25, press: PRESS.press, bristles: 44 });
  // Wing: overlapping strokes from the shoulder back, each shorter and
  // lower than the last, so they lie like folded feathers.
  for (let k = 0; k < 4; k++) {
    brush(g, R, 'wing' + k, at([[0.24 - k * 0.04, -0.22 + k * 0.045], [-0.08 - k * 0.02, -0.2 + k * 0.05], [-0.5 + k * 0.1, -0.2 + k * 0.07]]),
      { w: 40 - k * 5, tone: 0.9 - k * 0.08, dry: 0.4 + k * 0.08, grade: 0.4, press: PRESS.taper, bristles: 30 });
  }
  for (const [k, tip] of [[-1.02, -0.4], [-1.08, -0.24]].entries()) {
    brush(g, R, 'tail' + k, at([[-0.48, -0.06 + k * 0.05], [-0.74, -0.18 + k * 0.06], tip]), { w: 32, tone: 0.92, dry: 0.5, grade: 0.35, press: PRESS.taper, bristles: 26 });
  }
  brush(g, R, 'beak1', at([[0.7, -0.44], [0.86, -0.4], [1.0, -0.35]]), { w: 11, tone: 1, dry: 0.1, press: PRESS.taper, bristles: 8 });
  brush(g, R, 'beak2', at([[0.72, -0.28], [0.86, -0.31], [0.96, -0.33]]), { w: 8, tone: 1, dry: 0.1, press: PRESS.taper, bristles: 8 });
  // The eye: paper kept round a dark pupil inside the black cap.
  g.fillStyle = PAPER;
  g.beginPath();
  g.arc(b.eye[0], b.eye[1], 11, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = ink(0.5);
  g.lineWidth = 1.2;
  g.stroke();
  dot(g, b.eye[0] + 1.5, b.eye[1] + 1, 6, 1);
  for (const [i, leg] of b.legs.entries()) {
    const foot = [leg[1][0] + 4, 650 - i * 4];
    brush(g, R, 'leg' + i, [leg[0], foot], { w: 7, tone: 0.95, dry: 0.1, press: PRESS.blunt, bristles: 6 });
    brush(g, R, 'toe' + i, [[foot[0] - 16, foot[1] - 4], [foot[0], foot[1]], [foot[0] + 14, foot[1] + 2]], { w: 6, tone: 0.95, dry: 0.1, press: PRESS.taper, bristles: 6 });
  }

  caption(g, 'SUMI-E', font, ink(0.7), 880, 950);
}

module.exports = { draw };
