// The cue table of the loose forms, from the seam where they come unstuck
// through shot 4, in seconds from the start of that seam: when each form
// cracks free, lifts and lands, and then every move it makes on a written cue.
// Every piece that shows the forms reads its poses from here, and its sound
// its events, so picture and sound cannot disagree about when.
//
// THE FORMS BECOME A SCORE. The long lines slide into a staff, the big forms
// take their places round it as the band and play a phrase, and the small
// round forms, the notes, wait in a row under it. Then the digits of pi are
// read: a cursor runs along the staff, and as it reaches each place the next
// note hops onto the staff at the height its digit gives, and sounds it.

'use strict';

const { span, ease } = require('../../core/time.js');
const { rng } = require('../../core/rand.js');
const P = require('./paper.js');
const Dr = require('./draft.js');
const Pc = require('./papercut.js');
const Im = require('./impasto.js');
const Sc = require('./scrape.js');
const Hg = require('./hang.js');
const L = require('./loose.js');
const Wl = require('./wall.cjs');

// When, in seconds from the start of the seam where the forms come unstuck.
const T = {
  first: 0.9, last: 4.9,    // the first form cracks free, and the last
  loose: 5.95,              // every form lies loose
  staff: 6.0,               // the long lines slide into a staff
  queue: 7.3,               // the notes line up under it
  band: 8.9,                // the big forms take their places round it
  call: 11.6,               // and play a phrase
  read: 15.0,               // the digits are read
  sweep: [15.5, 20.6],      // the cursor runs along the staff
  chord: 20.9,              // the staff sounds the reading's chord, and its lines tremble
  release: 22.15,           // the forms let go of the painting and fall (see fall.js)
  box: [28.17, 31.07],      // the mat's bevel deepens into a box (see contain.cjs)
  close: [30.27, 34.47],    // the frame's two sides close in on the pile, which makes room (see fall.js)
};
const CLOSE = 150;          // how far in each side closes, in sheet units: the box goes from wide to nearly square
const IN = 3.2;             // the camera has come in onto the painting (see unstick.cjs)
const WALL = 359 / 30;      // the wall's last frame, this score's first
const SWING = 0.35;         // the light turns as fast as it did over the wall
const CRACK = 0.25, UP = 0.3, DOWN = 0.34, BOUNCE = 0.16;
const REST = 1;             // a loose form lies this high over the ground: its shadow shows

// The data, as readout reads it: pi's digits, one per note.
const DIGITS = '3141592653589793238';
// A minor pentatonic from A3, a degree per digit, as readout plays them.
const DEGREES = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
const ROOT = 57;

// The score's layout, in sheet units.
const STAFF = { x: 385, y: 474, gap: 32 };     // the middle line's middle, and the gap between lines
const NOTES = { x0: 215, pitch: 17.5, wait: 602 };

// The forms by their place in the style's order (see scrape.js forms).
const LINES = [8, 5, 54, 7, 9];                 // the staff, top to bottom
const NOTE_Z = [31, 32, 33, 34, 36, 52, 53, 60, 61, 63, 64, 65, 70, 71, 72, 73, 74, 75, 76];
const RAINBOW = [12, 13, 14, 15, 16, 17];

/** The staff's line `k`'s height, 0 the top. */
const lineY = (k) => STAFF.y + (k - 2) * STAFF.gap;
/** Where a note of digit `d` sits: the bottom line for 0, half a gap higher for each more. */
const digitY = (d) => lineY(4) - (d * STAFF.gap) / 2;
/** Note `n`'s place along the staff. */
const noteX = (n) => NOTES.x0 + n * NOTES.pitch;

/**
 * Build stage: the order the forms come free in -- a form only once every
 * one lying over it is free, the smaller first by and large -- each one's
 * crack, lift and landing, and then the score: every move each form makes,
 * and every sound.
 */
function write(s) {
  const R = rng(s.seed), n = s.skins.length, done = new Set(), order = [];
  while (order.length < n) {
    const free = s.skins.filter((k) => !done.has(k.i) && k.over.every((o) => done.has(o)));
    free.sort((a, b) => a.size * (0.5 + R('free', 'pick', a.i)) - b.size * (0.5 + R('free', 'pick', b.i)));
    done.add(free[0].i);
    order.push(free[0]);
  }
  s.freed = new Array(n);
  order.forEach((k, j) => {
    const on = T.first + (T.last - T.first) * (j / (n - 1)) ** 0.62, small = Math.min(1, 40 / k.size);
    const a = R('drift', 'angle', k.i) * Math.PI * 2, far = 2 + 9 * small * (0.4 + 0.6 * R('drift', 'far', k.i));
    s.freed[k.i] = {
      on, small, rush: (j / (n - 1)) ** 0.8, peak: 7 + 22 * small,
      drift: [Math.cos(a) * far, Math.sin(a) * far],
      turn: (R('drift', 'turn', k.i) - 0.5) * 0.4 * (0.2 + small),
    };
  });
  s.moves = s.skins.map(() => []);
  s.hops = s.skins.map(() => []);
  s.shakes = s.skins.map(() => []);
  s.sounds = [];
  s.loose = unstuck(s, T.loose);
  compose(s, R);
}

/** Every form's pose as it comes free, at second `sec`: a form lying on another rides on it. */
function unstuck(s, sec) {
  const own = s.skins.map((k) => freeing(s.freed[k.i], sec)), out = new Array(s.skins.length);
  const whole = (i) => {
    if (out[i]) return out[i];
    const p = own[i], b = s.skins[i].base;
    if (b < 0 || p.h <= 0) return (out[i] = p);
    const q = whole(b);
    return (out[i] = { ...p, x: p.x + q.x, y: p.y + q.y, h: p.h + q.h });
  };
  return s.skins.map((k) => whole(k.i));
}

/** A form's own pose as it comes free: its crack, its lift and its landing, a little away and turned. */
function freeing(c, sec) {
  const t0 = c.on + CRACK, t1 = t0 + UP, t2 = t1 + DOWN;
  if (sec < t0) return { x: 0, y: 0, turn: 0, h: 0, crack: span(c.on, t0, sec) };
  const go = ease.out(span(t0, t2, sec));
  let h;
  if (sec < t1) h = c.peak * ease.out(span(t0, t1, sec));
  else if (sec < t2) h = REST + (c.peak - REST) * (1 - ease.in(span(t1, t2, sec)));
  else h = REST + 0.8 * ease.bump(span(t2, t2 + BOUNCE, sec));
  return { x: c.drift[0] * go, y: c.drift[1] * go, turn: c.turn * go, h, crack: 1 };
}

/** The score: every move and hop after the forms lie loose, and the sound each makes. */
function compose(s, R) {
  const byZ = (z, j = 0) => s.skins.filter((k) => k.z === z)[j];
  const now = s.loose.map((p) => ({ x: p.x, y: p.y, turn: p.turn }));
  // A slide: form `k`'s middle to [X, Y] and its turn to `turn`, from `a` over `d` seconds at `rate`;
  // with `d` null, as long as its way and its weight make it, no two quite alike.
  let count = 0;
  const slide = (k, a, d, to, turn = now[k.i].turn, rate = 'out', heard = true) => {
    const from = { ...now[k.i] }, dest = { x: to ? to[0] - k.c[0] : from.x, y: to ? to[1] - k.c[1] : from.y, turn };
    const far = Math.hypot(dest.x - from.x, dest.y - from.y);
    if (d === null) d = Math.min(1.4, 0.3 + far * 0.0022 + k.size * 0.0016) * (0.85 + 0.3 * R('slide', 'length', count++));
    s.moves[k.i].push({ a, b: a + d, rate, from, to: dest });
    // Heard as it goes: its friction on the paint (see voices.js friction).
    if (heard && far > 12) s.sounds.push({ at: a, kind: 'slide', skin: k, length: d, far, rate, velocity: Math.min(1, 0.35 + far / 350) });
    now[k.i] = dest;
    return a + d;
  };
  const hop = (k, a, d, h) => { s.hops[k.i].push({ a, b: a + d, h }); return a + d; };
  const sound = (at, kind, k, note, velocity) => s.sounds.push({ at, kind, skin: k, note, velocity });
  // The turn that lays a line level, the shorter way round.
  const level = (k) => { const [p, q] = k.paths[0].pts; let a = -Math.atan2(q[1] - p[1], q[0] - p[0]); while (a > Math.PI / 2) a -= Math.PI; while (a < -Math.PI / 2) a += Math.PI; return a; };
  const upright = (k) => level(k) + Math.PI / 2;

  // The staff: each long line slides into place, and sounds its line's note, low and long.
  LINES.forEach((z, j) => {
    const k = byZ(z), end = slide(k, T.staff + j * 0.3, null, [STAFF.x, lineY(j)], level(k), 'inOut');
    sound(end, 'string', k, ROOT - 12 + DEGREES[[7, 5, 4, 2, 0][j]], 0.55 + 0.1 * j);
  });

  // The band takes its places, two by two on the beat, each landing a note of the chord.
  const beat = 0.42;
  const band = [
    [20, [128, 424], 0], [11, [140, 552], 0], [10, [562, 626], 0], [67, [430, 660], 0],
    [21, [455, 300], 0], [62, [345, 304], 0], [42, [560, 302], 0], [66, [650, 304], 0], [30, [STAFF.x + 176, lineY(0) - 34], -Math.PI / 2],
  ];
  const chord = [45, 52, 57, 60, 64, 67, 69, 72, 76];
  band.forEach(([z, to, turn], j) => {
    const k = byZ(z), end = slide(k, T.band + Math.floor(j / 2) * beat + (j % 2) * 0.12, null, to, turn);
    sound(end, k.size > 90 ? 'drum' : 'mallet', k, chord[j], 0.6);
    if (z === 21) { const l = byZ(35), a = T.band + Math.floor(j / 2) * beat + 0.06; slide(l, a, end - a, [to[0] + 64, to[1] + 7], 0.2); }
  });
  // The rainbow comes as one, its arcs nested again.
  const bow = RAINBOW.map((z) => byZ(z)), top = bow[bow.length - 1];
  bow.forEach((k, j) => slide(k, T.band + 2.3 + j * 0.03, 1.05, [k.c[0] + 170 - top.c[0], k.c[1] + 312 - top.c[1]], 0));
  sound(T.band + 3.2, 'bell', top, 64, 0.5);
  // The cursor stands at the staff's start, the bar lines at its end, the ruler under it.
  const cursor = byZ(40);
  sound(slide(cursor, T.band + 2.6, null, [STAFF.x - 185, STAFF.y], upright(cursor)), 'knock', cursor, 45, 0.5);
  [0, 1, 2].forEach((j) => { const k = byZ(41, j); sound(slide(k, T.band + 2.75 + j * 0.1, null, [STAFF.x + 172 + j * 8, STAFF.y], upright(k)), 'tick', k, 81, 0.35); });
  sound(slide(byZ(55), T.band + 2.9, null, [STAFF.x, lineY(4) + 24], 0), 'tick', byZ(55), 76, 0.3);
  [50, 51].forEach((z, j) => slide(byZ(z), T.band + 2.5 + j * 0.1, null, [292, 652 + j * 12], level(byZ(z))));

  // The call: the band plays a phrase, each form heard as it hops, spins, rocks or pecks, and all of them together last.
  const bt = 0.32, at = (beat) => T.call + beat * bt;
  const spin = (z, beat, turn, h, kind, note, v) => {
    const k = byZ(z), d = k.size > 90 ? 0.42 : 0.34;
    hop(k, at(beat), d, h);
    slide(k, at(beat), d, null, now[k.i].turn + turn, 'inOut');
    sound(at(beat) + d, kind, k, note, v);
  };
  const rock = (k, beat, turn, d) => {
    const t0 = now[k.i].turn;
    slide(k, at(beat), d * 0.35, null, t0 + turn, 'out');
    slide(k, at(beat) + d * 0.35, d * 0.35, null, t0 - turn * 0.6, 'inOut');
    slide(k, at(beat) + d * 0.7, d * 0.3, null, t0, 'inOut');
  };
  spin(20, 0, Math.PI / 2, 24, 'drum', 45, 0.85);
  spin(11, 1, Math.PI, 22, 'drum', 52, 0.8);
  spin(62, 1.5, Math.PI * 2, 18, 'mallet', 69, 0.65);
  const beak = byZ(21), b0 = [beak.c[0] + now[beak.i].x, beak.c[1] + now[beak.i].y];
  sound(slide(beak, at(2), 0.12, [b0[0] + 16, b0[1]]), 'mallet', beak, 72, 0.7);
  sound(slide(beak, at(2) + 0.14, 0.22, b0, now[beak.i].turn, 'inOut'), 'tick', beak, 84, 0.3);
  bow.forEach((k) => rock(k, 2.4, 0.2, 0.9));
  sound(at(2.4), 'bell', top, 64, 0.5);
  sound(at(2.4) + 0.32, 'bell', top, 67, 0.45);
  rock(byZ(10), 3, 0.24, 0.9);
  sound(at(3), 'drum', byZ(10), 40, 0.9);
  rock(byZ(67), 3.5, 0.3, 0.7);
  sound(at(3.5), 'mallet', byZ(67), 64, 0.6);
  spin(42, 4, Math.PI, 16, 'tick', 76, 0.6);
  spin(66, 4.5, Math.PI / 2, 14, 'tick', 79, 0.6);
  spin(20, 5, -Math.PI / 2, 18, 'drum', 45, 0.75);
  spin(11, 5.5, -Math.PI, 16, 'drum', 52, 0.7);
  spin(30, 6, 0, 12, 'mallet', 67, 0.6);
  spin(62, 6.5, 0, 12, 'mallet', 69, 0.55);
  // Last, all of them at once: a chord.
  for (const [z, kind, note] of [[20, 'drum', 45], [11, 'drum', 52], [10, 'drum', 40], [67, 'mallet', 64], [21, 'mallet', 69], [62, 'mallet', 72], [42, 'tick', 76], [66, 'tick', 79], [30, 'mallet', 67]]) {
    const k = byZ(z);
    hop(k, at(7), 0.4, k.size > 90 ? 14 : 18);
    sound(at(7) + 0.4, kind, k, note, 0.45);
  }
  bow.forEach((k) => hop(k, at(7), 0.4, 14));
  sound(at(7) + 0.4, 'bell', top, 69, 0.55);

  // The notes: in the order the reading will call them, a big one kept away from the next.
  const notes = NOTE_Z.map((z) => byZ(z)).sort((a, b) => b.size - a.size);
  const shift = Math.floor(R('notes', 'shift') * DIGITS.length);
  s.notes = new Array(DIGITS.length);
  notes.forEach((k, j) => { s.notes[(j * 7 + shift) % DIGITS.length] = k; });
  s.notes.forEach((k, n) => {
    const end = slide(k, T.queue + n * 0.07, null, [noteX(n), NOTES.wait], 0);
    sound(end, 'tick', k, 88, 0.12 + 0.1 * (n % 2));
  });

  // A breath before the reading: a ripple runs along the waiting notes, and the cursor rises to the staff.
  s.notes.forEach((k, n) => { hop(k, 14.3 + n * 0.022, 0.3, 10); sound(14.3 + n * 0.022 + 0.3, 'tick', k, 88 + (n % 3) * 3, 0.06); });
  hop(cursor, 14.35, 0.8, 12);

  // The reading: the cursor runs along the staff; as it reaches each place, that note hops up onto it.
  slide(cursor, T.sweep[0], T.sweep[1] - T.sweep[0], [STAFF.x + 163, STAFF.y], upright(cursor), 'linear', false);
  s.notes.forEach((k, n) => {
    const d = Number(DIGITS[n]), a = T.sweep[0] + ((noteX(n) - (STAFF.x - 185)) / (163 + 185)) * (T.sweep[1] - T.sweep[0]) - 0.28;
    hop(k, a, 0.3, 14 + d * 1.5);
    slide(k, a, 0.3, [noteX(n), digitY(d)], 0, 'inOut', false);
    // The reading grows as it goes, and the digits the picture sets highest ring out.
    sound(a + 0.3, 'note', k, ROOT + DEGREES[d], Math.min(0.95, 0.42 + 0.022 * n + (d >= 7 ? 0.12 : 0)));
  });
  // The reading ends on the staff's chord: the cursor knocks the end bar, each line is struck in turn and trembles.
  sound(T.sweep[1], 'knock', cursor, 45, 0.55);
  LINES.forEach((z, j) => {
    const k = byZ(z), a = T.chord + j * 0.06;
    s.shakes[k.i].push({ a, amp: 1.6 + 0.3 * j, hz: 6 + j * 0.7 });
    sound(a, 'string', k, ROOT - 12 + DEGREES[[7, 5, 4, 2, 0][j]], 0.75);
  });
  // The box: its board creaking as it deepens, thickest in the middle of the move, and its hollow ringing, low.
  const board = s.skins[0], [box0, box1] = T.box;
  for (let j = 0; j < 16; j++) {
    const u = (j + R('creak', 'at', j)) / 16, at = box0 + (box1 - box0) * u;
    sound(at, 'creak', board, 38 + Math.round(R('creak', 'note', j) * 6), 0.25 + 0.6 * Math.sin(Math.PI * u) * (0.6 + 0.4 * R('creak', 'level', j)));
  }
  // As the pile comes to rest, its chord: the reading's scale, held low and soft, rising out of the last strikes.
  [0, 3, 7, 10].forEach((d, j) => sound(T.release + 1.9 + j * 0.16, 'rest', board, ROOT - 12 + d, 0.55 - j * 0.06));
  sound(box0 + 0.25, 'hollow', board, 45, 0.8);
  // The frame's sides closing in, one each side: the creak of their board and wood on the table, thickest where they move fastest.
  const [p0, p1] = T.close;
  for (let j = 0; j < 20; j++) {
    const u = (j + R('close', 'at', j)) / 20;
    s.sounds.push({ at: p0 + (p1 - p0) * u, kind: 'creak', skin: board, note: 38 + Math.round(R('close', 'note', j) * 4), velocity: 0.3 + 0.6 * Math.sin(Math.PI * u), pan: j % 2 ? 0.55 : -0.55 });
  }
  sound(box0 + 1.9, 'hollow', board, 52, 0.55);
  for (const list of s.moves) list.sort((a, b) => a.a - b.a);
  s.sounds.sort((a, b) => a.at - b.at);
}

/** The camera shot 4 plays under: the Kandinsky's window, a strip of the mat round it. */
function stage(s) {
  const w = Hg.windowOf(s.hang.k);
  return { c: [(w[0] + w[2]) / 2, (w[1] + w[3]) / 2], z: Math.min(1200 / (w[2] - w[0]), 800 / (w[3] - w[1])) / 1.035, turn: 0 };
}

/**
 * The camera from IN on: over the painting, drifting a little as a hand
 * holds it, the drift growing from nothing so the camera's arrival is smooth.
 */
function camera(s, sec) {
  const v = stage(s), u = sec - IN, k = Math.min(1, u / 3) ** 2 * (3 - 2 * Math.min(1, u / 3));
  return { c: [v.c[0] + k * 5 * Math.sin(0.37 * u), v.c[1] + k * 3.5 * Math.sin(0.29 * u + 1)], z: v.z * (1 + k * 0.012 * Math.sin(0.21 * u)), turn: 0 };
}

/** The light's angle at second `sec`: it goes on turning as it did over the wall. */
const light = (s, sec) => s.light + (SWING * (WALL + sec)) / 12;

const BOARD = '#f3eee3';       // the mat's board, as hang.js lays it
const DEPTH = 0.16;            // how far the painting sinks into the box, as a share of its size

/**
 * A frame of the score at second `sec`, seen by camera `v`: the table, the
 * framed painting with no forms on it, every loose form in its pose over it,
 * and the frame; until the first form cracks, the painting whole, as the wall
 * laid it. `deep`, from 0 to 1, is how far the mat's bevel has deepened into a
 * box: the painting, and all that lies on it, sinks to the box's back, and the
 * board's four inner walls run from the window to it.
 */
function draw(g, s, sec, v, deep = 0) {
  const m = Dr.shot(v), d = g.getTransform ? g.getTransform() : null, dev = d ? Math.hypot(d.a, d.b) : 1;
  const pics = L.kept(g, s), pic = Hg.painting(g, s), a = light(s, sec);
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  const whole = (cg) => (pic.copy ? Dr.put(cg, pic) : Sc.paintImpasto(cg, s));
  Hg.drawHang(g, s, v, dev, a, whole, (cg, k, sh, lx, ly) => {
    // Once the box's sides close in, the frame is that much narrower each side and the table shows beyond it.
    const full = Hg.windowOf(k), c = pinch(s, sec), win = [full[0] + c, full[1], full[2] - c, full[3]];
    const out = Hg.grow(win, Hg.MAT + Hg.MOULD), back = 1 - DEPTH * deep;
    if (c > 0) { cg.save(); cg.beginPath(); cg.rect(out[0], out[1], out[2] - out[0], out[3] - out[1]); cg.clip(); }
    Hg.castShadow(cg, sh, Hg.SHEET, lx, ly, 0, 0.5);
    if (c > 0) cg.restore();
    const mx = (win[0] + win[2]) / 2, my = (win[1] + win[3]) / 2, rear = [mx + (win[0] - mx) * back, my + (win[1] - my) * back, mx + (win[2] - mx) * back, my + (win[3] - my) * back];
    if (deep > 0) {
      cg.save();
      cg.beginPath();
      cg.rect(win[0], win[1], win[2] - win[0], win[3] - win[1]);
      cg.clip();
      cg.translate(mx, my);
      cg.scale(back, back);
      cg.translate(-mx, -my);
    }
    if (sec < T.first) whole(cg);
    else {
      L.drawBare(cg, s, pics);
      for (const [sk, p] of poses(s, sec)) L.drawSkin(cg, s, pics, sk, p, a);
    }
    if (deep > 0) {
      cg.restore();
      walls(cg, win, rear, lx, ly, deep);
    }
    for (const r of [[out[0], out[1], out[2], win[1]], [out[0], win[3], out[2], out[3]], [out[0], win[1], win[0], win[3]], [win[2], win[1], out[2], win[3]]]) {
      Hg.castShadow(cg, sh, r, lx, ly, 0, 0.8);
    }
    Hg.frame(cg, win, lx, ly);
  });
  Hg.glow(g, s, v, a, 1);
  g.restore();
}

/**
 * The box's four inner walls, board from the window `win` back to the
 * painting at `rear`, each lit by how it faces the light (lx, ly), darker
 * towards the back, and the shade each casts on the painting.
 */
function walls(g, win, rear, lx, ly, deep) {
  const sides = [
    [[win[0], win[1]], [win[2], win[1]], [rear[2], rear[1]], [rear[0], rear[1]], 0, 1],
    [[win[2], win[1]], [win[2], win[3]], [rear[2], rear[3]], [rear[2], rear[1]], -1, 0],
    [[win[2], win[3]], [win[0], win[3]], [rear[0], rear[3]], [rear[2], rear[3]], 0, -1],
    [[win[0], win[3]], [win[0], win[1]], [rear[0], rear[1]], [rear[0], rear[3]], 1, 0],
  ];
  for (const [a, b, c, d, nx, ny] of sides) {
    // The wall's inward face: lit when it faces the light, in shade when it faces away.
    const lit = nx * lx + ny * ly, k = Math.round(22 * lit);
    const grad = g.createLinearGradient((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (c[0] + d[0]) / 2, (c[1] + d[1]) / 2);
    grad.addColorStop(0, shadeOf(BOARD, k + 4));
    grad.addColorStop(1, shadeOf(BOARD, k - 26));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]);
    g.closePath();
    g.fill();
    // Its shade on the back, along the walls between it and the light.
    if (lit < -0.05) {
      const reach = 26 * deep * -lit, gx = nx * reach, gy = ny * reach, mid = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
      const sh = g.createLinearGradient(mid[0], mid[1], mid[0] + gx, mid[1] + gy);
      sh.addColorStop(0, `rgba(30, 20, 10, ${(0.32 * -lit * deep).toFixed(3)})`);
      sh.addColorStop(1, 'rgba(30, 20, 10, 0)');
      g.fillStyle = sh;
      g.beginPath();
      g.moveTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.lineTo(d[0] + gx, d[1] + gy); g.lineTo(c[0] + gx, c[1] + gy);
      g.closePath();
      g.fill();
    }
  }
  // The corners where two walls meet, a crease of shade.
  g.strokeStyle = `rgba(60, 45, 30, ${(0.35 * deep).toFixed(3)})`;
  g.lineWidth = 0.8;
  g.beginPath();
  for (const [p, q] of [[[win[0], win[1]], [rear[0], rear[1]]], [[win[2], win[1]], [rear[2], rear[1]]], [[win[2], win[3]], [rear[2], rear[3]]], [[win[0], win[3]], [rear[0], rear[3]]]]) { g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }
  g.stroke();
}

/** Colour `hex` lightened (k > 0) or darkened by `k` levels a channel. */
function shadeOf(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${[16, 8, 0].map((b) => Math.max(0, Math.min(255, ((n >> b) & 255) + k))).join(', ')})`;
}

/**
 * How far in each of the box's sides has closed at second `sec`, in sheet
 * units: the frame the box draws, and the fall's side walls.
 */
const pinch = (s, sec) => CLOSE * ease.inOut(span(T.close[0], T.close[1], sec));

/** Form `i`'s pose on its cues at second `sec` (from T.loose on). */
function cued(s, i, sec) {
  const p = { ...s.loose[i], crack: 1 };
  for (const m of s.moves[i]) {
    if (sec < m.a) break;
    const u = ease[m.rate](span(m.a, m.b, sec));
    p.x = m.from.x + (m.to.x - m.from.x) * u;
    p.y = m.from.y + (m.to.y - m.from.y) * u;
    p.turn = m.from.turn + (m.to.turn - m.from.turn) * u;
  }
  p.h = REST;
  for (const q of s.hops[i]) if (sec > q.a && sec < q.b) p.h += q.h * ease.bump(span(q.a, q.b, sec));
  // A struck line trembles across its length, dying away over a second or so.
  for (const q of s.shakes[i]) {
    if (sec <= q.a) continue;
    const u = sec - q.a, y = q.amp * Math.exp(-u / 0.9) * Math.sin(2 * Math.PI * q.hz * u);
    p.x -= Math.sin(p.turn) * y;
    p.y += Math.cos(p.turn) * y;
  }
  return p;
}

/** Form `i`'s pose at second `sec` as it falls, read from the track fall.js kept, or null before the release. */
function fallen(s, i, sec) {
  const F = s.fall;
  if (!F || sec < F.at) return null;
  const f = Math.min(F.frames - 1, (sec - F.at) * F.hz), f0 = Math.floor(f), f1 = Math.min(F.frames - 1, f0 + 1), u = f - f0, n = s.skins.length;
  const o0 = (f0 * n + i) * 3, o1 = (f1 * n + i) * 3, t = F.track;
  return { x: t[o0] + (t[o1] - t[o0]) * u, y: t[o0 + 1] + (t[o1 + 1] - t[o0 + 1]) * u, turn: t[o0 + 2] + (t[o1 + 2] - t[o0 + 2]) * u, h: REST, crack: 1 };
}

/** Every form and its pose at second `sec`, lowest first, so each lies over what is under it. */
function poses(s, sec) {
  const at = sec < T.loose ? unstuck(s, sec) : s.skins.map((k) => fallen(s, k.i, sec) || cued(s, k.i, sec));
  return s.skins.map((k) => [k, at[k.i]]).sort((a, b) => (a[1].h > 0.01) - (b[1].h > 0.01) || a[1].h - b[1].h || a[0].z - b[0].z);
}

/** The sounding events, { kind, at, skin, velocity, note }: each crack and landing, then every cue's. */
function events(s) {
  const out = [];
  for (const k of s.skins) {
    const c = s.freed[k.i], v = 0.45 + 0.35 * c.rush;
    out.push({ kind: 'crack', at: c.on, skin: k, velocity: Math.min(0.8, v * (0.8 + 0.4 * (1 - c.small))) });
    // Each lands on a note of the scale, higher the smaller it is, the rush climbing it towards the staff.
    const degree = Math.min(DEGREES.length - 1, Math.round(c.small * 5 + c.rush * 4));
    out.push({ kind: 'land', at: c.on + CRACK + UP + DOWN, skin: k, note: ROOT + DEGREES[degree], velocity: Math.min(1, v * 0.8) });
  }
  // Each strike of the fall, as hard as it struck, the smaller form of the two heard; where many strike at
  // once, each a little softer, so the crash is a crowd of small sounds and not one wall of them.
  if (s.fall) {
    const hits = s.fall.hits, crowd = (h) => hits.filter((o) => Math.abs(o.at - h.at) < 0.04).length, last = new Map();
    for (const h of hits) {
      const a = s.skins[h.i], b = h.j >= 0 ? s.skins[h.j] : null, k = b && b.size < a.size ? b : a;
      // Forms in a pile jostle all the time: only a real knock is heard, a form at most every quarter second,
      // and softly while the sides push the pile.
      const pushed = h.at >= T.close[0];
      if (h.speed < (pushed ? 180 : 150) || h.at - (last.get(k) || -1) < 0.25) continue;
      last.set(k, h.at);
      const degree = Math.max(0, Math.min(DEGREES.length - 1, Math.round(9 - Math.log2(k.size / 4) * 1.6)));
      out.push({ kind: 'strike', at: h.at, skin: k, note: ROOT - 12 + DEGREES[degree] + (k.shape === 'line' ? 12 : 0), velocity: Math.max(0.12, Math.min(1, Math.log(h.speed / 60) / Math.log(25)) * Math.min(1, 1.4 / Math.sqrt(crowd(h)))) * (pushed ? 0.6 : 1) });
    }
  }
  return out.concat(s.sounds).sort((a, b) => a.at - b.at);
}

/**
 * Where a piece of the score starts, in the score's seconds: each begins on
 * the last frame of the one before it, `frames` frames long at 30 a second.
 */
function starts(...frames) {
  const out = [0];
  for (const n of frames) out.push(out[out.length - 1] + (n - 1) / 30);
  return out;
}

/**
 * The build every piece of the score shares: the Kandinsky as the knife left
 * it, the wall it hangs in, with the works kept at the sizes the wall showed
 * them at, so its last frame is the next piece's first, the forms as skins
 * and this cue table.
 */
const build = [
  ['lay the paper', P.lay], ['cut it', Pc.cut], ['spread the ground', Im.coat], ['lay the dabs', Im.dabs],
  ['outline the bird', Sc.hull], ['lay out the forms', Sc.forms], ['hang the works', Hg.hang],
  ['frame them', Wl.build.find((b) => b[0] === 'frame them')[1]], ['free the forms', L.skins], ['write the cues', write],
];

module.exports = { build, poses, events, stage, camera, draw, starts, cued, pinch, T, IN, WALL };
