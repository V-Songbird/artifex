// refit -- a container whose contents refit to the box it is drawn in.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other example
// draws at one design box and leaves another aspect to scaling. This one
// declares `boxes`, reads the box it was solved for from `state.box`, and lays
// itself out again: the container takes the box less a fixed margin, and the
// things are never scaled down, so a box no roomier and no taller than the
// default holds fewer of them at their size rather than the same ones squeezed.
//
// THE THINGS ARE THE SAME THINGS AT EVERY BOX. Thing i has the same kind,
// colour and spin wherever it is drawn, addressed by its index, and the things
// arrive in index order, so a box that holds 60 holds the first 60 or so of the
// same things a box that holds 200 does. Changing the box reads as the
// container changing, not as another picture. Every thing is scaled by one
// factor, the same for all: the root of the ratio of the container's room
// to the default box's, times the fourth root of the ratio of its height to
// the default's, where that comes to more than one, and one where it comes
// to less, so no box scales the things down, and the factor changes with
// the box without a jump. A roomier box holds bigger things, the largest
// about half as many as the default box; a taller one bigger things too,
// since a thing takes more frames to fall and settle through it, even one
// narrower than the default with less room; a box no roomier and no taller
// than the default keeps the things at their size and holds fewer. A film
// scales them for the roomiest box its timeline visits, never for its
// frame, which is never shown, and never past what the smallest box it
// visits can take, one of the smallest things high with the clearance a
// release needs, so a film that visits a small box is not emptied of things
// too big for it. The solve's cost is the count of things the sim steps by
// the frames it steps them through: a thing in free fall above everything
// it could touch is stepped outside the sim, and once every thing has
// landed in a still box, only what still moves is simulated, with what it
// could reach, while the heap settles. At the smallest grain and the
// strongest grip the default box solves in about three seconds on the
// owner's machine, give or take the fifth that a pile's last second of
// settling varies by; the wide short boxes whose factor comes to about
// one, which hold up to an eighth more things than the default box, take
// up to a tenth or so longer, and every other declared box less, where the
// largest box took half a minute at the default size. The film along its
// timeline is not bound by that: it simulates the whole pile on every
// frame on which the box moves, and takes longer at the smallest grain
// than any still box does, about half as long again.
//
// IT FILLS ONCE. The things rain into the container from above the frame, each
// released over the run of columns, a small thing wide each, with the most
// room for it, while there is room for one of the smallest of them, more a
// frame the more the container holds, so that the largest box fills within
// the film too, and one a frame while the box widens, since a heavier rain
// onto a pile that is itself moving flickers enough for the film to warn of
// flashing, none while it narrows, since the walls would squeeze out what
// it let in, and none that could not land before the box next narrows, so
// the walls never close under a rain; a thing too big for the room there
// is now is passed over, so a short box takes the things that fit it; the
// pile is then full, and stays full while the box stands still, though
// the pile packs closer as it settles: a rain that followed that room
// would never end. A container a few of its biggest things wide packs
// looser, and the fill counts on less of its room, so it is not overfilled
// by things that then land over the rim; when its things grip little it
// counts what is still falling into it more by area, since they cannot
// heap where they land, so a channel barely wider than its biggest things,
// declared full with its drops still in the air, lands nearer the rim than
// a count of their whole height would leave it. A pile at rest in a still box,
// nothing in it moving a unit a frame, is held as it is, and never before,
// so nothing is frozen while it still moves. A box change never empties
// or refills the container: it only moves the walls and the floor, three
// lines of core/sim.js that follow the box, and the pile is a physical
// pile solved by it, so what the walls squeeze climbs over its neighbours
// to the nearest place that holds it, and what no longer fits vanishes,
// shrinking from its lowest contact with what held it, the floor, a wall
// or a thing, or, when that lowest is a thing that shrinks from it,
// directly or through others, from another it touches, so it never
// floats off it, kept inside the walls, and inside
// the box, as they close: a thing that comes to rest with its centre over
// the rim, or a landed thing the closing walls push up through the pile so that it
// pokes over the rim. Nothing is taken in mid-air: a thing falling in is
// never taken, even as it bounces off the pile, since it lands first, and
// a landed thing the squeeze flings up flies on until it touches the pile
// again, or a wall where it is drawn, and goes there: a thing over the rim
// goes only while what it touches, thing to thing, reaches the floor or a
// wall, so two flung up together, touching only each other, fly on. One
// flung up out of the frame goes out of sight. A wider box lets the pile relax
// towards the wall that moved, keeping its order, and opens room, which
// fills without a rain: nothing falls in after the first fill. The next
// things, in the index order the first fill left off at, appear in the room
// that opens, each in the deepest place where it rests overlapping nothing:
// on the floor, against a wall that stands still beside a thing, or
// cradled on two things that move together and are not foretold to draw
// apart while it grows, starting with their motion, since a pile the
// widening box lets slump flows, and what appears on it flows with it; a
// thing that holds it, beside a wall as in a cradle, has landed, moves no
// faster than a landed thing, and is at least a quarter its size as it is
// drawn now: no limit for a whole thing, since the biggest thing is less
// than four times the smallest, but a thing in its first frames of growth
// holds nothing much bigger than it is drawn. Each grows there from
// nothing to its size: one on the
// floor up from its lowest point, so it stands on the floor at every
// size, moving with it where the box grows taller; one held by things
// from its contact with the last-born of them, drawn touching that
// holder's drawn disc, whole or itself still growing, as it touches it
// whole, so it neither hangs over a holder drawn small nor sinks into
// one, and slides along it into its place as it grows, stopped short
// where it would end nearer another holder than whole, in anything else
// drawn, a holder shrinking away included, or in the floor; on the growth
// test's timelines the way never ends in anything, so no test pins that
// stop. Each grows over the frames a thing that no longer
// fits takes to shrink away, its weight growing with its area, so it
// rests on what holds it without pressing it apart, and settles with the
// pile under it: a slumping pile
// is chaotic, so on the growth test's timelines in tests/examples.test.js,
// its own film and four widenings, nine in ten stay within two units of
// what holds them as they grow and none sinks a score of units below it,
// and a fast widening may lift a growing thing off what holds it; a place
// in the path of a thing it does not touch, moving at it so that it would
// run into it as it grows, is passed over: under one still sinking, since
// a pocket under one opens as it sinks, or beside one the slumping pile
// carries along; of the things a place touches, only a floor place's
// neighbour may be creeping at it, since a wall's thing is nearly still
// and a cradle's two move together, so the pile may nudge a thing born on
// the floor along it, unless that neighbour stands over the place, its
// centre higher than the place's top, and sinks at it by more than a unit a
// frame: a big thing slumping onto a place in its overhang would crush
// what grows there. As many grow in a frame as find a place while the
// box moves, since a thing that grows from nothing does not flicker as a
// falling one does, and as many as a still box's rain would bring while
// it stands still, looking at up to three times as many things as it may
// take; one that no place takes waits, and is tried again first on the
// frames after, three a frame, since the places a big thing needs open
// later than a small one's, until more than nine wait, when the oldest
// is passed over. On
// the same timelines the widened box ends holding whole things over at
// least four fifths of the area a box filled at that size holds them
// over, and nine tenths of it after a widening that stops, or that
// narrows and then holds still, or from a tall narrow box, whose slumped
// column keeps flowing to the end of the film; a very fast widening, or
// one that other tests play, may end short of that. A still box's pile
// is full once it is at rest with no place
// left, since a pile still slumping opens places as it goes, or once its
// area is taken.
//
// A BOX THAT MOVES DURING THE FILL IS THE SAME RULE. Arrivals and walls are
// both functions of the frame: things in flight land in the container as it
// stands when they land, settled things follow the walls of the moment, and
// each release looks at the room the container has now and at when the box
// next narrows, so `full` is always relative to the current box. A box that
// narrows while filling waits, from the last release that can land before
// the walls move, and fills on once it stops; one that widens keeps the
// rain going longer. The first fill ends the first time the container is
// full while its box stands still, even with its last drops still in the
// air: nothing is released after it, whatever the box does, and whatever
// comes after grows in place, once those drops have landed, so nothing
// grows where a thing still falling in could land on it, and never
// within the frames it takes to grow of a coming narrowing, as the rain
// waits within a fall of one, so nothing is squeezed out while it grows,
// which would pop, its shrink starting from its full size.
//
// ITS FILM CHANGES BOX AS IT PLAYS. `reframe` takes it from wide to portrait
// to square inside one 1280 x 720 frame; the solve runs the pile frame by
// frame, the walls moving with the box between frames, and keeps every frame,
// so the draw is a lookup and a scrub lands where playback does.

'use strict';

const { rng } = require('../core/rand.js');
const { clamp } = require('../core/num.js');
const { ease } = require('../core/time.js');
const { simulate } = require('../core/sim.js');
const font = require('../core/stroke-font.js');

// Fixed in design units, so the container grows and shrinks with the box and
// the things do not.
const SIDE = 40;
const TOP = 100;
const BOTTOM = 76;
const RMIN = 12;
const RMAX = 44;
// How far the drawn walls stand over the rim: a wall is touched only there.
const LIP = 14;
// One of the smallest fourth of the things: the room a release needs is
// measured in these.
const SMALL = RMIN + (RMAX - RMIN) / 16;

// The frame grid the solve runs on: `time` below declares the same.
const HZ = 30;
const SECONDS = 8;
const FRAMES = HZ * SECONDS;
// Design units per second squared: a fall through the frame takes two thirds
// of a second. The sim steps each frame in SUBSTEPS and keeps exp(-DRAG) of a
// free thing's speed a second; a thing in free fall above everything it
// could touch is stepped the same way outside the sim.
const GRAVITY = 3200;
const DRAG = 0.4;
const SUBSTEPS = 6;
const STEP = 1 / (HZ * SUBSTEPS);
const KEEP = Math.exp(-DRAG * STEP);
// Arrivals a frame may release at most, more for a container that holds more
// things than the default one at grain 1, and the room a release needs beyond
// the thing's own height. A thing slower than this over two frames in a row
// has landed: a free fall is twice as fast after its first frame.
const RATE = 3;
const AREA = (1280 - 2 * SIDE) * (720 - TOP - BOTTOM);
const CLEAR = 16;
// How many times the container's height the things waiting to fall in may
// stand over the frame before the rest wait.
const QUEUE = 1.5;
const LANDED = 160;
// Frames a landing takes to count beyond the fall and the roll along the
// pile: two slow frames, a bounce and the jostling of a pile things are still
// landing on.
const LAND = 8;
// Frames a thing that no longer fits takes to vanish, and how much of a
// thing's travel along the pile turns it: the rest is a slide.
const FADE = 5;
const ROLL = 0.35;
// A thing further than this from every thing, wall and floor touches
// nothing: a solved pile leaves a hair between neighbours, never a unit; and
// a thing pressed deeper than this into a neighbour shares the press with
// it, so neither can sleep while the other is simulated.
const TOUCH = 2;
const HAIR = 0.5;
// How much narrower than a thing that appears after the first fill the gap
// between the two things that cradle it must be, so a cradle that spreads
// a little as the pile slumps still holds it, and how far that gap may be
// foretold to spread while the thing grows.
const WEDGE = 8;
const SPREAD = 2;
// A pile whose every thing has landed and moved less than this over a frame
// is at rest: it is held there until the box moves or a thing arrives, so a
// still box costs no solving once its pile is still, and nothing in it is
// frozen while it still moves. With six passes a frame, every declared box
// comes to rest within two seconds and a half of its last landing, at every
// grain and grip; the largest box's heap at the smallest grain and the
// strongest grip takes the longest, a thing deep in it popping a few units
// now and then.
const REST = 1;
// A pile of this many things or fewer is solved with the passes a squeeze
// takes, since it can afford them.
const FEW = 100;
// How much of its area a full container's pile fills.
const PACKING = 0.8;

const PAPER = '#efe9dd';
const INSIDE = '#e3dac8';
const INK = '#1f1d1a';
// The frame around a box smaller than it, and the hatch over it.
const SURROUND = '#cfc6b4';
const HATCH = '#bfb5a1';
const PALETTE = ['#d9a441', '#c4553a', '#2f7f7a', '#2d4a7a', '#8aa37b', '#f4efe4'];

/** The container inside a box: its walls, rim and floor. */
function container(W, H) {
  return { x0: SIDE, x1: W - SIDE, rim: TOP, floor: H - BOTTOM };
}

/**
 * Where the box stands at frame f: its size and its corner, centred in the
 * frame, as the clock reports it to `draw`. Without a timeline it is the
 * state's box, filling the frame.
 */
function boxAt(s, f) {
  const keys = s.reframe;
  if (!keys) return { x: 0, y: 0, w: s.box.w, h: s.box.h };
  const t = f / (FRAMES - 1);
  let from = 0;
  while (from < keys.length - 1 && t >= keys[from + 1].t) from++;
  const to = Math.min(from + 1, keys.length - 1);
  const u = to === from ? 0 : clamp((t - keys[from].t) / (keys[to].t - keys[from].t), 0, 1);
  const e = ease.smooth(u);
  const w = keys[from].w + (keys[to].w - keys[from].w) * e;
  const h = keys[from].h + (keys[to].h - keys[from].h) * e;
  return { w, h, x: (s.box.w - w) / 2, y: (s.box.h - h) / 2 };
}

/**
 * How much of its size a thing has at frame f: all of it, but for one that
 * appeared after the first fill, which grows from nothing over the frames a
 * thing that no longer fits takes to shrink away. Its weight in the sim
 * grows with its area, so a thing still growing rests on what holds it
 * without pressing it apart.
 */
function grown(th, f) {
  return th.grows ? Math.min(1, (f - th.born + 1) / (FADE + 1)) : 1;
}

/** Thing i, the same at every box: its size, kind, colour and spin. */
function thingOf(R, i, grain) {
  return {
    i,
    r: (RMIN + (RMAX - RMIN) * R('thing', 'size', i) ** 2) * grain,
    kind: Math.floor(R('thing', 'kind', i) * 4),
    fill: PALETTE[Math.floor(R('thing', 'colour', i) * PALETTE.length)],
    spin: (R('thing', 'spin', i) - 0.5) * 5,
    // Where across its column it is released.
    aim: R('thing', 'aim', i),
    // The frames it is released, lands and vanishes on, how many frames in
    // a row it has been slow, and whether it has come within reach of the
    // pile, from when on the sim moves it.
    born: 0, landed: Infinity, gone: Infinity, slow: 0, near: false,
  };
}

/**
 * The container's walls and floor over a frame: three lines, the walls
 * reaching from the floor up past `top`, the highest thing still falling, so
 * a thing falling in beside a wall that is closing is pushed inside it. While
 * the box moves, each line follows it from where it stood at the frame's
 * start, `a`, to where it stands at its end, `b`: a wall moves whole, so it
 * carries what rests against it, and the floor's ends draw in or out about
 * its middle, so it lifts or lowers the pile without dragging it sideways.
 */
function wallsOver(a, b, top) {
  const ca = container(a.w, a.h);
  const cb = container(b.w, b.h);
  const L0 = a.x + ca.x0, L1 = b.x + cb.x0;
  const R0 = a.x + ca.x1, R1 = b.x + cb.x1;
  const F0 = a.y + ca.floor, F1 = b.y + cb.floor;
  const still = L0 === L1 && R0 === R1 && F0 === F1;
  const at = (x0, y0, x1, y1) => (still ? [x0, y0] : (sec) => { const q = sec * HZ; return [x0 + (x1 - x0) * q, y0 + (y1 - y0) * q]; });
  return [
    { from: at(L0, top, L1, top + F1 - F0), to: at(L0, F0, L1, F1) },
    { from: at(R0, top, R1, top + F1 - F0), to: at(R0, F0, R1, F1) },
    { from: at(L0, F0, L1, F1), to: at(R0, F0, R1, F1) },
  ];
}

module.exports = {
  name: 'refit',
  size: { w: 1280, h: 720 },
  boxes: { w: [240, 1920], h: [240, 1920] },
  // Its film: the pile, the same pile squeezed into a portrait box, then
  // released into a square. The box holds still before and after each
  // change, the last hold long enough for the opened room to fill, so the
  // release lands instead of ending mid-move.
  reframe: [
    { t: 0, w: 1280, h: 720 },
    { t: 0.34, w: 1280, h: 720 },
    { t: 0.46, w: 405, h: 720 },
    { t: 0.56, w: 405, h: 720 },
    { t: 0.9, w: 720, h: 720 },
    { t: 1, w: 720, h: 720 },
  ],
  seed: 5,
  outputs: ['raster', 'vector'],
  time: { duration: SECONDS, hz: HZ },

  params: {
    grain: { min: 0.6, max: 1.6, value: 1, meaning: 'How big the things are; smaller things let more of them fit in the same box' },
    grip: { min: 0, max: 1.2, value: 0.25, meaning: 'How much the things grip each other and the walls: low lets them roll level, high heaps them up' },
  },

  build: [
    ['fill the container', (s) => {
      // Frame by frame: the things released this frame join the pile, the
      // pile is solved over the frame with the walls moving to where the box
      // stands at its end, and what the walls pushed up out of the container
      // leaves. Every frame keeps x, y and turn of every thing released so
      // far, a thing that leaves this frame where the walls left it; one not
      // yet released, or gone before, holds NaN. A thing's `landed` is the
      // frame it came to rest on, Infinity while it falls.
      const R = rng(s.seed);
      const { grip } = s.params;
      // The things scale up with the root of the container's room over the
      // default box's, and again with the fourth root of its height over
      // the default box's: the solve's cost is the count of things by the
      // frames they fall and settle through, and a taller box takes more
      // of those, so it holds fewer things, bigger. The factor is never
      // under one, so a short or a narrow box keeps them at their size and
      // holds fewer, and it changes with the box without a jump. On a
      // timeline the container is the roomiest box it visits, never the
      // frame, which is never shown and may be roomier than any of them,
      // and the smallest box the film visits must still take one of the
      // smallest things with the room a release needs, so a film that
      // visits a small box is not emptied of things too big for it.
      const roomOf = (b) => (b.w - 2 * SIDE) * (b.h - TOP - BOTTOM);
      const boxes = s.reframe || [s.box];
      const most = boxes.reduce((m, b) => (roomOf(b) > roomOf(m) ? b : m));
      const room = roomOf(most);
      const tall = (most.h - TOP - BOTTOM) / (720 - TOP - BOTTOM);
      const least = boxes.reduce((m, b) => Math.min(m, b.w - 2 * SIDE, b.h - TOP - BOTTOM), Infinity);
      const fit = Math.max(1, (least - CLEAR) / (2 * SMALL * s.params.grain));
      const grain = s.params.grain * Math.min(fit, Math.max(1, Math.sqrt(room / AREA * Math.sqrt(tall))));
      const things = [];
      const live = { x: [], y: [], vx: [], vy: [], turn: [] };
      const snap = (f) => {
        const out = new Float64Array(3 * things.length);
        for (let k = 0; k < things.length; k++) {
          const on = things[k].gone >= f;
          out[3 * k] = on ? live.x[k] : NaN;
          out[3 * k + 1] = on ? live.y[k] : NaN;
          out[3 * k + 2] = on ? live.turn[k] : NaN;
        }
        return out;
      };
      s.frames = [snap(0)];
      // The next frame on which the box narrows, from each frame: a release
      // must land before it, so the walls never close under a rain.
      const narrows = new Array(FRAMES).fill(Infinity);
      for (let f = FRAMES - 2, b = boxAt(s, FRAMES - 1); f >= 0; f--) {
        const a = boxAt(s, f);
        narrows[f] = b.w < a.w || b.h < a.h ? f + 1 : narrows[f + 1];
        b = a;
      }
      let next = 0;
      // After the first fill, the things no place took yet, oldest first,
      // three times RATE at most.
      const waiting = [];
      let last = boxAt(s, 0);
      let resting = false;
      let full = false;
      // Whether the first fill is over: room that opens after it is filled
      // where it opens, without a rain.
      let filled = false;
      // The things simulated while a still box's pile settles, null while
      // it fills or moves.
      let awake = null;
      for (let f = 1; f < FRAMES; f++) {
        const box = boxAt(s, f);
        const c = container(box.w, box.h);
        const L = box.x + c.x0;
        const Rw = box.x + c.x1;
        const rim = box.y + c.rim;
        const floor = box.y + c.floor;
        // The container in columns a small thing wide, each column's top as
        // the pile stands: the lowest point of every landed thing standing
        // over it, less the height the things still falling onto it will
        // add, each its area at the pile's packing over its own width, or
        // in a narrow container over the columns it covers, as below; and
        // the train of them, a diameter each, so that releases spread across
        // the columns instead of queuing over one. A thing stands over every
        // column its width covers, so a thing wider than a column, or one
        // the walls have moved since it was released, is counted where it
        // stands.
        const small = SMALL * grain;
        const cols = Math.max(1, Math.floor((Rw - L) / small));
        const width = (Rw - L) / cols;
        const top = new Array(cols).fill(floor);
        const train = new Array(cols).fill(0);
        // How much of its area the pile fills: a container narrower than
        // three of its biggest things packs looser, the more the narrower,
        // since things that cannot sit side by side stack in a zigzag, or
        // up a wall at the strongest grip; a channel barely wider than its
        // biggest things packs about two thirds of its area. A falling thing
        // covers more columns than its own width, by up to a column on
        // either side. A wide container counts its whole height on each of
        // them, which leaves room for the heap a rain piles where it lands;
        // in a narrower container things that grip little cannot heap, so
        // it counts the thing's area spread over the columns it covers, the
        // more the narrower, from none of it at three of its biggest things
        // wide to all of it at one, and the more the less they grip, from
        // none of it at a grip of 0.5 to all of it at the default 0.25 and
        // under: things that grip more heap up the walls, and counted by
        // area their last drops landed over the rim. Counted whole, a
        // channel barely wider than its biggest things was declared full
        // with a fifth of its height still empty under the rim once its
        // drops had landed.
        const packing = PACKING * (1 - 0.25 * Math.max(0, 2 * RMAX * grain / (Rw - L) - 1 / 3));
        const exact = Math.min(1, 6 * (1 - packing / PACKING)) * clamp((0.5 - grip) / 0.25, 0, 1);
        const rise = (th, n) => Math.PI * th.r * th.r / (packing * (2 * th.r + (n * width - 2 * th.r) * exact));
        const spanOf = (x, r) => [clamp(Math.floor((x - r - L) / width), 0, cols - 1), clamp(Math.ceil((x + r - L) / width) - 1, 0, cols - 1)];
        // What the container holds, as area: the things' own, and the room
        // a pile of them takes.
        const cap = packing * (Rw - L) * (floor - rim);
        let area = 0;
        for (let k = 0; k < things.length; k++) {
          const th = things[k];
          if (th.gone < Infinity) continue;
          area += Math.PI * th.r * th.r;
          const [c0, c1] = spanOf(live.x[k], th.r);
          for (let c = c0; c <= c1; c++) {
            if (th.landed < f) top[c] = Math.min(top[c], live.y[k] - th.r);
            else { top[c] -= rise(th, c1 - c0 + 1); train[c] += 2 * th.r; }
          }
        }
        // Where a thing of radius r is released: the first column of the run
        // of columns its width covers with the most room under its train,
        // among the runs with room for the thing and its clearance, to a
        // hair, since the smallest thing a film scales for its smallest box
        // is exactly as tall as that room less the clearance; -1 when none
        // has. The run is given with it.
        const place = (r) => {
          const need = Math.ceil(2 * r / width);
          let best = -1;
          let score = -Infinity;
          for (let c = 0; c + need <= cols; c++) {
            let room = Infinity;
            let queue = 0;
            for (let d = c; d < c + need; d++) { room = Math.min(room, top[d] - rim); queue = Math.max(queue, train[d]); }
            if (room + 1e-9 >= 2 * r + CLEAR && room - queue > score) { best = c; score = room - queue; }
          }
          return [best, need];
        };
        // Releases, in index order, each over the run of columns with the
        // most room under its train, while some run has room for a small
        // thing, one of the smallest fourth; a thing too big for the room
        // there is now is passed over, so a short or a nearly full
        // container takes the things that fit it. Each is placed above the
        // frame, between the walls as they stand at both ends of the frame,
        // over anything released lately that is still there, with its whole
        // height to stand in, since a thing that lands on the crest of a
        // pile stands on it whole; when the things waiting to fall in there
        // stand higher over the frame than the container is tall and a half,
        // the rest wait for them to fall, so nothing enters the frame from a
        // height that would cross it in a few frames. A container that holds
        // more things than the default one releases more a frame, so it
        // fills within the film too; one whose box is widening releases one
        // a frame, since a rain of several a frame onto a pile that is
        // itself moving flickers, enough for the film to warn of flashing,
        // though after the first fill, when nothing is released and things
        // grow in place instead, as many as find a place, since they come
        // from nothing and do not flicker; one whose box is narrowing
        // releases none, since the walls would squeeze out what it let in,
        // and it fills on once they stop; and one whose box will narrow
        // before a thing released now could land waits, so the walls never
        // close under a rain. Once no run of columns has room, counting what
        // is still falling into it, the container is full, and stays full
        // while the box stands still: a pile that packs closer as it settles
        // opens room, and a rain that followed it would never end, costing a
        // solve of the whole pile for every one of its drops. After the
        // first fill, a still box is full once its pile is at rest and no
        // place is left, or once its things take the area its pile can
        // fill, and stays full while the box stands still.
        const moving = box.w !== last.w || box.h !== last.h;
        const shrinking = box.w < last.w || box.h < last.h;
        if (moving) full = false;
        const rate = shrinking ? 0 : moving ? (filled ? Infinity : 1) : Math.max(RATE, Math.ceil(RATE * (Rw - L) * (floor - rim) / (grain * grain * AREA)));
        const was = container(last.w, last.h);
        const inL = Math.max(L, last.x + was.x0);
        const inR = Math.min(Rw, last.x + was.x1);
        const inFloor = Math.min(floor, last.y + was.floor);
        // Where a thing of radius r rests in the room the first fill left
        // open, and how it moves there: the deepest place, between the walls
        // as they stand at both ends of the frame and whole under the rim,
        // where it overlaps nothing: in a corner of the floor, on the floor
        // against a thing, against a wall on a thing beside it, or cradled
        // between two things; or null. On the floor it needs nothing else,
        // and starts with the floor's motion, still unless the box is
        // growing taller. What holds it otherwise has landed, moves no
        // faster than a landed thing, since a pile that a widening box lets
        // slump flows, and what appears on it flows with it, and is at
        // least a quarter its size as it is drawn now. A whole thing is
        // always that big, the biggest thing being less than four times the
        // smallest, so the rule bars only a thing in its first frames of
        // growth, drawn small and light, from holding what is much bigger
        // than it is drawn; waiting for each holder to grow whole would
        // leave the room a widening opens half filled, and held only by
        // things half its size, a big thing found no place on a heap of
        // small ones, and a tall column widened ended with a heap half as
        // high as a fill at that size. A wall holds it only while that wall stands
        // still, on a thing nearly still, since one moving away would leave
        // it to roll off the thing beside it. Two things cradle it only
        // while they move together, within two units a frame of each other,
        // since a slumped heap keeps creeping long after its box stops, and
        // it starts with their motion; only while they draw apart slowly
        // enough that the gap between them spreads by less than SPREAD while
        // it grows; only with its centre over both of theirs, since one sunk
        // between them wedges them apart; and only where the gap between
        // them is narrower than it by WEDGE, so it does not fall through as
        // they settle.
        const spot = (r) => {
          if (inR - inL < 2 * r) return null;
          const ks = [];
          for (let k = 0; k < things.length; k++) if (things[k].gone === Infinity) ks.push(k);
          const was1 = s.frames[f - 1];
          const was2 = s.frames[f - 2];
          const speed = (k) => Math.hypot(live.vx[k], live.vy[k]);
          const firm = (k) => things[k].landed < f && things[k].r * grown(things[k], f) >= r / 4 && speed(k) < LANDED;
          // The seconds a thing takes to grow.
          const span = (FADE + 1) / HZ;
          let best = null;
          // A place, moving at (vx, vy), touching the things `holders`
          // names, which the path test below exempts, since a touch is its
          // degenerate case: a cradle's two move together and a wall's
          // thing stands nearly still, so their approach is bounded; a
          // floor place's neighbour may creep at it, and then nudges the
          // thing along the floor, but one standing over it and sinking at
          // it more than a unit a frame is not exempt, and passes the place
          // over.
          const take = (x, y, vx = 0, vy = 0, ...holders) => {
            if (best && y <= best[1]) return;
            if (y - r < rim || y > inFloor - r + 1e-9 || x < inL + r - 1e-9 || x > inR - r + 1e-9) return;
            for (const k of ks) {
              const ex = live.x[k] - x, ey = live.y[k] - y;
              const rk = r + things[k].r;
              const c = ex * ex + ey * ey - rk * rk;
              if (c < -1e-6 * rk) return;
              if (holders.includes(k)) continue;
              // Nor in the path of a thing it does not touch, moving
              // towards it, as it moves now, so that it would run into it
              // while it grows: under a thing still sinking, since a pocket
              // under one opens as it sinks, or beside one the slumping
              // pile carries at it.
              const wx = live.vx[k] - vx, wy = live.vy[k] - vy;
              const a = wx * wx + wy * wy, b = 2 * (ex * wx + ey * wy);
              const disc = b * b - 4 * a * c;
              if (b < 0 && disc >= 0 && -b - Math.sqrt(disc) <= 2 * a * span) return;
            }
            best = [x, y, vx, vy, holders];
          };
          // The floor as it stood at the frame's start, moving as it moves:
          // a floor that descends as the box grows taller carries down what
          // stands on it, so a thing born there starts with its motion.
          const sink = (floor - inFloor) * HZ;
          take(inL + r, inFloor - r, 0, sink);
          take(inR - r, inFloor - r, 0, sink);
          for (const a of ks) {
            const xa = live.x[a], ya = live.y[a], ra = r + things[a].r;
            const h = inFloor - r - ya;
            if (Math.abs(h) < ra) {
              const d = Math.sqrt(ra * ra - h * h);
              // Its neighbour beside it, or over it and not sinking at it.
              const beside = ya >= inFloor - 2 * r || live.vy[a] - sink < REST * HZ ? [a] : [];
              take(xa - d, inFloor - r, 0, sink, ...beside);
              take(xa + d, inFloor - r, 0, sink, ...beside);
            }
            if (!firm(a)) continue;
            if (speed(a) < REST * HZ) {
              if (inL === L && xa >= inL + r && xa - inL - r < ra) take(inL + r, ya - Math.sqrt(ra * ra - (xa - inL - r) ** 2), 0, 0, a);
              if (inR === Rw && xa <= inR - r && inR - r - xa < ra) take(inR - r, ya - Math.sqrt(ra * ra - (inR - r - xa) ** 2), 0, 0, a);
            }
            for (const b of ks) {
              const rb = r + things[b].r;
              const dx = live.x[b] - xa, dy = live.y[b] - ya;
              if (b <= a || Math.abs(dx) >= ra + rb || !firm(b) || Math.hypot(live.vx[b] - live.vx[a], live.vy[b] - live.vy[a]) > 2 * REST * HZ) continue;
              const d = Math.hypot(dx, dy);
              if (d >= ra + rb - WEDGE || d <= Math.abs(ra - rb) || 3 * b >= was2.length || Number.isNaN(was2[3 * a]) || Number.isNaN(was2[3 * b])) continue;
              // How fast they draw apart now, and how fast they did over
              // the frame before: the gap between them, going on as that
              // foretells over the frames the thing grows, spreads by less
              // than SPREAD.
              const ux = dx / d, uy = dy / d;
              const now = (live.vx[b] - live.vx[a]) * ux + (live.vy[b] - live.vy[a]) * uy;
              const then = ((was1[3 * b] - was2[3 * b] - was1[3 * a] + was2[3 * a]) * ux + (was1[3 * b + 1] - was2[3 * b + 1] - was1[3 * a + 1] + was2[3 * a + 1]) * uy) * HZ;
              if ((now + (now - then) * HZ * span / 2) * span > SPREAD) continue;
              const m = (d * d + ra * ra - rb * rb) / (2 * d);
              const w = Math.sqrt(ra * ra - m * m);
              // The higher of the two places that touch both.
              const side = dx > 0 ? 1 : -1;
              const x = xa + (m * dx + side * w * dy) / d;
              const y = ya + (m * dy - side * w * dx) / d;
              if ((x - xa) * (x - live.x[b]) <= 0 && y <= Math.min(ya, live.y[b])) take(x, y, (live.vx[a] + live.vx[b]) / 2, (live.vy[a] + live.vy[b]) / 2, a, b);
            }
          }
          return best;
        };
        let came = 0;
        const join = (th, x, y, vx = 0, vy = 0) => {
          area += Math.PI * th.r * th.r;
          th.born = f;
          came++;
          things.push(th);
          live.x.push(x); live.y.push(y); live.vx.push(vx); live.vy.push(vy); live.turn.push(R('thing', 'turn', th.i) * Math.PI * 2);
        };
        const again = waiting.slice(0, RATE);
        for (let n = 0, tried = 0; n < rate && tried < 3 * rate && !full; tried++) {
          const retry = again.length > 0;
          const th = thingOf(R, retry ? again.shift() : next, grain);
          // After the first fill, the next thing appears where it rests in
          // the room that opened, moving as what holds it moves, and grows
          // to its size there as `draw` shows it; one that no place takes
          // waits, and is tried again first on the frames after, up to RATE
          // of the waiting a frame, oldest first, since the places a big
          // thing needs open later than a small one's: passed over for
          // good, the big things left a widened box's heap of small ones
          // half as high as a fill at its size. Once more things wait than
          // three times RATE, the oldest is passed over. A try costs the
          // frame a try, not one of the things it may take: the frame
          // shares three tries for each. With no place even for a small
          // thing, the frame takes no more, and a pile at rest is full.
          if (filled) {
            // Nothing grows while a thing the rain released still falls:
            // `spot` knows nothing of the paths of things in the air, and
            // could put one where a falling thing then lands.
            if (things.some((th) => th.landed === Infinity && th.gone === Infinity)) break;
            // Nor while the box will narrow before a thing born now is
            // whole, as the rain waits: a thing the walls squeeze out
            // while it grows pops, its shrink starting from its full size.
            if (f + FADE >= narrows[f]) break;
            if (area + Math.PI * small * small > cap || !spot(small)) { full = resting || area + Math.PI * small * small > cap; break; }
            const at = spot(th.r);
            if (retry) { if (at) waiting.splice(waiting.indexOf(th.i), 1); } else {
              next++;
              if (!at && waiting.push(th.i) > 3 * RATE) waiting.shift();
            }
            if (area + Math.PI * th.r * th.r > cap || !at) continue;
            // What holds it, for `draw` to rest it on: the things of a
            // wall place or a cradle; the floor holds a floor place, its
            // neighbour only stands beside it.
            Object.assign(th, { landed: f, near: true, grows: true, on: at[1] < inFloor - th.r ? at[4] : [] });
            join(th, ...at);
            n++;
            continue;
          }
          // The first fill ends the first time the container is full while
          // its box stands still, even with its last drops still in the
          // air: one that is full while it widens, with things still
          // falling into the room it opens, rains on.
          if (area + Math.PI * small * small > cap || place(small)[0] < 0) { full = true; filled = !moving; break; }
          const [col, need] = place(th.r);
          const x = col < 0 ? 0 : clamp(L + width * col + th.r + (width * need - 2 * th.r) * th.aim, inL + th.r, inR - th.r);
          let y = -th.r;
          for (let k = 0; col >= 0 && k < things.length; k++) {
            const o = things[k];
            if (o.gone < Infinity || o.landed < f) continue;
            const dx = Math.abs(x - live.x[k]);
            if (dx < th.r + o.r) y = Math.min(y, live.y[k] - Math.sqrt((th.r + o.r) ** 2 - dx * dx));
          }
          if (y < -QUEUE * (floor - rim)) break;
          // Its fall to the run's pile, longer by a sixth of the drag over
          // its seconds, half as long again for the bounce and the roll
          // along the pile to where it rests, and the frames a landing
          // takes to count: the box must not narrow before then, so the
          // rain stops in time for its last drop to land before the walls
          // close, and goes on once they stop. Measured over the declared
          // boxes, the roll takes up to as long again as the fall for a few
          // things in a hundred, and the last drops of a rain that stops in
          // time land six frames or more before the walls move.
          if (col >= 0) {
            const fall = HZ * Math.sqrt(2 * Math.max(0, Math.min(...top.slice(col, col + need)) - th.r - y) / GRAVITY);
            if (f + 1.5 * fall * (1 + DRAG * fall / (6 * HZ)) + LAND >= narrows[f]) break;
          }
          next++;
          n++;
          if (area + Math.PI * th.r * th.r > cap || col < 0) continue;
          join(th, x, y);
          for (let d = col; d < col + need; d++) { top[d] -= rise(th, need); train[d] += 2 * th.r; }
        }
        // The pile over this frame, the walls and the floor moving with the
        // box. A narrowing wall squeezes the whole pile, which takes more
        // relaxing than a landing does; a pile in the tallest box stands
        // seven hundred things deep, and presses the small things at its
        // floor into each other with fewer passes, six steps of six
        // relaxations a frame, where five steps popped a small thing out
        // of a narrow channel and left the largest box creeping to the end
        // of the film; and a pile of a hundred things or fewer, or one in a
        // channel narrower than four of its biggest things, affords the
        // passes a squeeze takes, since the cost is pairs by passes, where
        // a narrow channel of things nearly as wide as itself jams a pair
        // under a big one with six, and a deep one presses the two small
        // things at its floor into each other by most of a radius. A pile
        // at rest in a still box stays as it is.
        if (moving || came) resting = false;
        const on = [];
        let high = -2 * RMAX;
        for (let k = 0; k < things.length; k++) {
          if (things[k].gone < Infinity) continue;
          on.push(k);
          high = Math.min(high, live.y[k] - 2 * things[k].r);
        }
        if (!resting && on.length) {
          // A thing in free fall above everything it could touch this frame
          // is not simulated: it falls straight, as the sim would step it,
          // until it comes within reach of the floor or of a simulated thing
          // over its columns, counting the way it falls this frame and two
          // of the smallest things more, and is simulated from then on. A
          // box that moves simulates everything, since its walls move. The
          // things a tall box's rain holds in the air are a third of what
          // its solve would otherwise step.
          const reach = new Array(cols).fill(floor);
          const cover = (k) => { const [c0, c1] = spanOf(live.x[k], things[k].r); for (let c = c0; c <= c1; c++) reach[c] = Math.min(reach[c], live.y[k] - things[k].r); };
          for (const k of on) if (things[k].near) cover(k);
          const bodies = [];
          const falling = [];
          for (const k of on) {
            const th = things[k];
            if (!th.near && !moving) {
              const [c0, c1] = spanOf(live.x[k], th.r);
              let top = floor;
              for (let c = c0; c <= c1; c++) top = Math.min(top, reach[c]);
              if (live.y[k] + th.r + (live.vy[k] + GRAVITY / HZ) / HZ + 2 * small < top) { falling.push(k); continue; }
              cover(k);
            }
            th.near = true;
            bodies.push(k);
          }
          // Once every thing has landed in a still box, the pile settles:
          // a heap goes on slipping here and there for a second or two,
          // a few things at a time. Only what still moves is simulated
          // then, with what it could reach: a thing that moved a unit or
          // more over the last frame, and every thing within a biggest
          // thing of it, are simulated, and a thing within a biggest thing
          // of a simulated one is held in place, as the bed it rests on;
          // a held thing that a simulated one presses into deeper than a
          // hair is simulated too, since it was sharing that press, and
          // held it would throw the other off by the whole of it. The
          // simulated set only grows while the pile settles, so the bed
          // never changes under it from one frame to the next: a bed that
          // held things this frame and gave way the next would shake the
          // pile awake for ever. Every thing is simulated again as soon as
          // the box moves or a thing arrives.
          const held = new Set();
          if (!moving && f > 1 && !falling.length && bodies.every((k) => things[k].landed < f)) {
            if (!awake) {
              awake = new Set();
              const a = s.frames[f - 1];
              const b = s.frames[f - 2];
              for (const k of bodies) if (Math.hypot(a[3 * k] - b[3 * k], a[3 * k + 1] - b[3 * k + 1]) >= REST || Number.isNaN(b[3 * k])) awake.add(k);
            }
            const big = 2 * RMAX * grain;
            const cell = 2 * big;
            const cells = new Map();
            const keyOf = (cx, cy) => (cy + 4096) * 8192 + cx + 4096;
            for (const k of bodies) {
              const key = keyOf(Math.floor((live.x[k] - L) / cell), Math.floor(live.y[k] / cell));
              const list = cells.get(key);
              if (list) list.push(k); else cells.set(key, [k]);
            }
            // Every thing whose gap to thing k is under `margin`.
            const around = (k, margin, fn) => {
              const cx = Math.floor((live.x[k] - L) / cell);
              const cy = Math.floor(live.y[k] / cell);
              for (let i = cy - 1; i <= cy + 1; i++) {
                for (let j = cx - 1; j <= cx + 1; j++) {
                  const list = cells.get(keyOf(j, i));
                  if (!list) continue;
                  for (const o of list) {
                    if (o === k) continue;
                    const gap = Math.hypot(live.x[o] - live.x[k], live.y[o] - live.y[k]) - things[o].r - things[k].r;
                    if (gap < margin) fn(o, gap);
                  }
                }
              }
            };
            const stack = [...awake];
            const wake = (k) => { if (!awake.has(k)) { awake.add(k); stack.push(k); } };
            const was = s.frames[f - 2];
            for (const k of stack.slice()) if (Math.hypot(live.x[k] - was[3 * k], live.y[k] - was[3 * k + 1]) >= REST) around(k, big, wake);
            while (stack.length) around(stack.pop(), big, (o, gap) => { if (gap < -HAIR) wake(o); else held.add(o); });
            for (const k of awake) held.delete(k);
            bodies.length = 0;
            bodies.push(...awake, ...held);
          } else awake = null;
          const run = bodies.length ? simulate({
            frames: 2, hz: HZ, substeps: shrinking ? 2 * SUBSTEPS : SUBSTEPS, iterations: shrinking || on.length <= FEW || 2 * RMAX * grain / (Rw - L) > 0.25 ? 10 : 6,
            gravity: [0, GRAVITY], drag: DRAG, restitution: 0.05, friction: grip,
            particles: bodies.map((k) => (held.has(k)
              ? { x: live.x[k], y: live.y[k], radius: things[k].r, mass: things[k].r ** 2, hold: Infinity }
              : { x: live.x[k], y: live.y[k], vx: live.vx[k], vy: live.vy[k], radius: things[k].r, mass: (things[k].r * grown(things[k], f)) ** 2 })),
            walls: wallsOver(last, box, high),
          }) : null;
          let calm = !moving && !falling.length;
          for (const k of falling) {
            const th = things[k];
            let y = live.y[k];
            let vy = live.vy[k];
            for (let i = 0; i < SUBSTEPS; i++) {
              vy = (vy + GRAVITY * STEP) * KEEP;
              const to = y + vy * STEP;
              vy = (to - y) / STEP;
              y = to;
            }
            live.turn[k] += th.spin / HZ;
            live.y[k] = y; live.vy[k] = vy;
            th.slow = Math.hypot(live.vx[k], vy) < LANDED ? th.slow + 1 : 0;
          }
          bodies.forEach((k, p) => {
            const th = things[k];
            const [x, y] = run.at(1, p);
            const [vx, vy] = run.velocity(1, p);
            if (th.landed > f || Math.hypot(x - live.x[k], y - live.y[k]) > REST) calm = false;
            // It part rolls, part slides as it moves along the pile, and turns
            // as it falls.
            live.turn[k] += th.landed < f ? ROLL * (x - live.x[k]) / th.r : th.spin / HZ;
            live.x[k] = x; live.y[k] = y; live.vx[k] = vx; live.vy[k] = vy;
            th.slow = Math.hypot(vx, vy) < LANDED ? th.slow + 1 : 0;
            if (th.landed > f && th.slow > 1) th.landed = f;
          });
          // Landed with its centre over the rim, a thing no longer fits;
          // while the walls close, a landed thing that pokes over the rim
          // goes before they can throw it out, whichever way it moves, since
          // a rim that comes down over the pile pushes it up as surely as a
          // floor that rises. Nothing is taken in the air: a thing falling
          // in is never taken, even as it bounces off the pile, since it
          // lands first, and the walls never close under a rain, since the
          // rain stops in time to land; and a landed thing that a squeeze
          // flings up over the rim flies on until it touches the pile again,
          // or a wall where it is drawn, and goes there, or out of the frame,
          // where it goes as it leaves, out of sight: higher than it stood
          // a frame ago, since the speed a squeeze leaves it with can point
          // either way. A thing over the rim goes only while its contact
          // reaches the floor or a wall: it is under a touch from one, or
          // from a thing that is, and so on, thing to thing. Two things the
          // squeeze flings up together touch each other and nothing else,
          // so both fly on.
          // A wall counts only where it is drawn, from the floor up to its
          // lip over the rim: the sim's wall lines reach on up over the
          // box, so a thing flung up along one is pushed inside it, but it
          // touches no wall anyone can see there, and flies on.
          const over = new Set(on.filter((k) => live.y[k] < (shrinking ? rim + things[k].r : rim) && things[k].landed <= f));
          const grounded = new Set();
          if (over.size) {
            for (const k of on) {
              const r = things[k].r;
              const up = Math.max(0, rim - LIP - live.y[k]);
              if (Math.min(floor - live.y[k] - r, Math.hypot(live.x[k] - L, up) - r, Math.hypot(Rw - live.x[k], up) - r) < TOUCH) grounded.add(k);
            }
            const stack = [...grounded];
            while (stack.length) {
              const k = stack.pop();
              for (const j of on) if (!grounded.has(j) && Math.hypot(live.x[j] - live.x[k], live.y[j] - live.y[k]) - things[k].r - things[j].r < TOUCH) { grounded.add(j); stack.push(j); }
            }
          }
          // What a thing that goes shrinks from, as `draw` shrinks it: of
          // what it touches, what it touches lowest: the floor, -1, a wall
          // where it is drawn, -2 the left and -3 the right, at the height
          // of the thing's centre, or of the wall's lip for a thing over
          // it, or a thing, its index; a thing goes only while it touches
          // one of them. Its contacts, lowest first.
          const under = (k) => {
            const x = live.x[k], y = live.y[k], r = things[k].r;
            const up = Math.max(0, rim - LIP - y);
            const touches = [];
            if (floor - y - r < TOUCH) touches.push([-1, y + r]);
            if (Math.hypot(x - L, up) - r < TOUCH) touches.push([-2, y + up]);
            if (Math.hypot(Rw - x, up) - r < TOUCH) touches.push([-3, y + up]);
            for (const j of on) {
              const d = Math.hypot(live.x[j] - x, live.y[j] - y);
              if (j !== k && d - r - things[j].r < TOUCH) touches.push([j, y + r * (live.y[j] - y) / d]);
            }
            return touches.sort((a, b) => b[1] - a[1]).map(([j]) => j);
          };
          // A thing that goes with others this frame takes what it touches
          // lowest once that is settled: the floor, a wall, a thing that
          // stays, or one that goes and has taken its own. While none can,
          // all waiting on one another, the first that touches something
          // settled takes the lowest of those, and each thing on the way
          // from it, lowest contact to lowest contact, up to where that way
          // loops, takes the one before it; the loop then takes its own
          // lowest in turn. So a thing takes another contact only when what
          // it touches lowest shrinks, directly or through others, from it,
          // and following what each shrinks from never leads back to it:
          // two that go together never each shrink from the other, tied to
          // nothing else. Each goes touching what reaches the floor or a
          // wall, so one always can.
          const goes = new Map(on.filter((k) => over.has(k) && grounded.has(k)).map((k) => [k, under(k)]));
          const settled = (j) => j < 0 || !goes.has(j) || things[j].from !== undefined;
          for (let left = goes.size; left;) {
            const ready = [...goes].filter(([k, touches]) => things[k].from === undefined && settled(touches[0]));
            for (const [k, touches] of ready) { things[k].from = touches.find(settled); left--; }
            if (ready.length) continue;
            const [k, touches] = [...goes].find(([j, them]) => things[j].from === undefined && them.some(settled));
            const way = [k];
            for (let j = touches[0]; !way.includes(j); j = goes.get(j)[0]) way.push(j);
            const loop = way.indexOf(goes.get(way.at(-1))[0]);
            things[k].from = touches.find(settled); left--;
            for (let i = 1; i <= loop; i++) { things[way[i]].from = way[i - 1]; left--; }
          }
          for (const k of on) {
            const th = things[k];
            const y = live.y[k];
            if (goes.has(k) || (y < -th.r && y < s.frames[f - 1][3 * k + 1])) { th.gone = f; area -= Math.PI * th.r * th.r; calm = false; }
          }
          resting = calm;
        }
        s.frames.push(snap(f));
        last = box;
      }
      s.things = things;
    }],
  ],

  draw(g, s, t, clock) {
    const f = clock.frame;
    const box = clock.box || { x: 0, y: 0, w: s.box.w, h: s.box.h };
    const c = container(box.w, box.h);
    if (clock.box) surround(g, s, box);
    g.fillStyle = PAPER;
    g.fillRect(box.x, box.y, box.w, box.h);
    g.fillStyle = INSIDE;
    g.fillRect(box.x + c.x0, box.y + c.rim, c.x1 - c.x0, c.floor - c.rim);

    const rim = box.y + c.rim;
    const floor = box.y + c.floor;
    const snap = s.frames[f];
    // Where each thing is drawn this frame, in index order, so a holder,
    // which comes before what it holds, is placed before it. What no longer
    // fits shrinks away from its lowest contact, or from another it touches
    // when that lowest shrinks from it, as below, kept inside the
    // walls, and inside the box as its top comes down, as they go on
    // closing; what was taken above the box, flung out of it or out of the
    // frame, is not kept inside it, out of sight or over the surround it
    // was flying over.
    // What appears after the first fill grows from nothing where it rests,
    // the mirror of shrinking: one on the floor grows up from its lowest point,
    // so it stands on the floor at every size; one held by things grows
    // from its contact with the last-born of them, drawn touching that
    // holder's drawn disc, whole or still growing, at the angle it touches
    // it whole and as far from it as whole, so it neither hangs over a
    // holder drawn small nor sinks into one, and slides along it into its
    // place as it grows, whole where the holder is. It moves straight
    // there from where it would grow alone, and stops short where it
    // would end in the floor, nearer another holder than whole or in
    // anything else drawn but a thing that shrinks from it, directly or
    // through others, which moves with it, so it rests on what stops it and
    // is drawn into nothing it did not already start in; a solved pile leaves only
    // overlaps of a hair, and on the growth test's timelines that is all
    // the start overlap there is. No current timeline makes the way end in
    // anything, so no test pins the stop.
    const discs = s.things.map((th, k) => {
      if (th.gone <= f) {
        if (f >= th.gone + FADE) return null;
        const was = s.frames[th.gone];
        const scale = 1 - (f - th.gone + 1) / (FADE + 1);
        return { x: was[3 * k], y: was[3 * k + 1], r: th.r * scale, turn: was[3 * k + 2], scale, gone: true };
      }
      if (th.born > f) return null;
      const scale = grown(th, f);
      return { x: snap[3 * k], y: snap[3 * k + 1] + th.r * (1 - scale), r: th.r * scale, turn: snap[3 * k + 2], scale };
    });
    // What no longer fits shrinks from the contact the build recorded for
    // it, its lowest or, when that lowest is a thing that shrinks from it,
    // directly or through others, another it touches, the mirror of growth, as far from what it touched
    // there as when it went, so it never floats off what held it: one on
    // the floor down to the floor as it stands now, one on a wall to the
    // wall, one on a thing to that thing's drawn disc, whole, shrinking or
    // still growing, at the angle it touched it: one that shrinks from a
    // thing still growing, directly or through others, is placed again
    // once that thing has slid along what holds it, below; one flung out
    // of the frame shrinks where it went. A holder shrinking away too is
    // placed first; following holders never leads back to the thing. Each
    // is then kept inside the walls, and the box when it went inside it,
    // as drawn, as they close: one the box's top comes down on, or carried
    // up there by a holder flung up over it, stays under the top.
    const shrink = (k) => {
      const at = discs[k];
      const th = s.things[k];
      if (!at || !at.gone || at.placed) return;
      at.placed = true;
      const was = s.frames[th.gone];
      const b = boxAt(s, th.gone);
      const cb = container(b.w, b.h);
      if (th.from === -1) at.y = floor - (b.y + cb.floor - was[3 * k + 1] - th.r) - at.r;
      else if (th.from < -1) {
        // A wall touches it level with its centre, or at its lip for one
        // over the lip, and goes on touching it there as the wall stands
        // now, at its lip once the lip comes down past that.
        const right = th.from === -3;
        const touch = Math.max(was[3 * k + 1], b.y + cb.rim - LIP);
        const dx = was[3 * k] - b.x - (right ? cb.x1 : cb.x0), dy = was[3 * k + 1] - touch;
        const d = Math.hypot(dx, dy);
        const reach = at.r + d - th.r;
        at.x = box.x + (right ? c.x1 : c.x0) + reach * dx / d;
        at.y = Math.max(touch, rim - LIP) + reach * dy / d;
      } else if (th.from >= 0 && discs[th.from]) {
        const j = th.from;
        shrink(j);
        const dx = was[3 * k] - was[3 * j], dy = was[3 * k + 1] - was[3 * j + 1];
        const d = Math.hypot(dx, dy);
        const reach = at.r + discs[j].r + d - th.r - s.things[j].r;
        at.x = discs[j].x + reach * dx / d;
        at.y = discs[j].y + reach * dy / d;
      }
      at.x = clamp(at.x, box.x + c.x0 + at.r, box.x + c.x1 - at.r);
      if (was[3 * k + 1] - th.r >= b.y) at.y = clamp(at.y, box.y + at.r, floor - at.r);
    };
    for (let k = 0; k < discs.length; k++) shrink(k);
    // Whether thing o shrinks away from thing k, directly or through others
    // shrinking away.
    const rides = (o, k) => {
      for (let j = o; discs[j]?.gone; j = s.things[j].from) if (s.things[j].from === k) return true;
      return false;
    };
    s.things.forEach((th, k) => {
      const at = discs[k];
      const holders = at && !at.gone && at.scale < 1 && th.on ? th.on.filter((j) => discs[j] && !discs[j].gone) : [];
      if (!holders.length) return;
      const riders = [...discs.keys()].filter((o) => rides(o, k));
      // Where its drawn disc touches the last-born holder's drawn disc as
      // it touches that holder whole; it moves straight there from where
      // it would grow alone.
      const whole = (j) => Math.hypot(snap[3 * j] - snap[3 * k], snap[3 * j + 1] - snap[3 * k + 1]) - th.r - s.things[j].r;
      const j = holders.at(-1);
      const dx = snap[3 * k] - snap[3 * j], dy = snap[3 * k + 1] - snap[3 * j + 1];
      const d = Math.hypot(dx, dy);
      const reach = at.r + discs[j].r + whole(j);
      const mx = discs[j].x + reach * dx / d - at.x, my = discs[j].y + reach * dy / d - at.y;
      // How much of the way it goes: all of it, unless it would end in the
      // floor, nearer a holder than whole or in anything else drawn, where
      // it stops at the edge of what it would end in. One it already starts
      // in, however deep, does not hold it back: a solved pile leaves only
      // overlaps of a hair, and on the growth test's timelines a hair is
      // all the start overlap there is, within the test's unit. The way
      // itself, which is never drawn, may skim what it ends clear of: a
      // thing sliding along one holder of a cradle grazes the other by a
      // unit or so on a few frames, and a bound on the way, not on its
      // end, held it in place for those frames and let it jump after. On
      // the growth test's timelines the way never ends in anything, so no
      // test pins this bound: the way lies inside the thing's own whole
      // disc, or under it where a holder is drawn small. A holder shrinking
      // away, whose solved place is gone, bounds as anything else drawn,
      // by its shrinking disc; a thing born later, which has not yet slid,
      // bounds where it would grow alone. A thing that shrinks from this
      // one, directly or through others, bounds nothing of its way: it is
      // placed again from where this one ends, so it moves with it.
      let t = my > 0 ? Math.min(1, (floor - at.r - at.y) / my) : 1;
      discs.forEach((it, o) => {
        if (!it || o === k || riders.includes(o)) return;
        const R = at.r + it.r + (th.on.includes(o) && !it.gone ? whole(o) : 0);
        const ex = at.x - it.x, ey = at.y - it.y;
        const c0 = ex * ex + ey * ey - R * R;
        if (c0 <= 0 || (ex + mx) ** 2 + (ey + my) ** 2 >= R * R) return;
        const a = mx * mx + my * my;
        const b = 2 * (ex * mx + ey * my);
        t = Math.min(t, (-b - Math.sqrt(b * b - 4 * a * c0)) / (2 * a));
      });
      at.x += Math.max(0, t) * mx;
      at.y += Math.max(0, t) * my;
      for (const o of riders) discs[o].placed = false;
      for (const o of riders) shrink(o);
    });
    let held = 0;
    discs.forEach((at, k) => {
      if (!at) return;
      if (!at.gone) {
        if (at.y + at.r < 0) return;
        if (at.y >= rim) held++;
      }
      thing(g, s.things[k], at.x, at.y, at.turn, at.scale);
    });
    walls(g, c, box.x, box.y, box.w, `${held} things`);
  },
};

/**
 * The frame around a smaller box: a hatched wash, each line wavering a
 * little, and the box's soft shadow cast on it down and to the right, so the
 * box sits on the wash rather than cut out of it.
 */
function surround(g, s, box) {
  const { w: W, h: H } = s.box;
  const R = rng(s.seed);
  g.fillStyle = SURROUND;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = HATCH;
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  g.beginPath();
  let n = 0;
  for (let d = -H; d < W; d += 14, n++) {
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const x = d + H * u + (R('hatch', 'x', n * 16 + k) - 0.5) * 3;
      const y = H * u + (R('hatch', 'y', n * 16 + k) - 0.5) * 3;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
  }
  g.stroke();
  g.fillStyle = INK;
  g.globalAlpha = 0.07;
  for (let i = 1; i <= 4; i++) g.fillRect(box.x + 4 * i, box.y + 4 * i, box.w, box.h);
  g.globalAlpha = 1;
}

/**
 * The walls over the contents, so a thing against one sits inside it, and the
 * count under the floor.
 */
function walls(g, c, ox, oy, W, label) {
  const l = ox + c.x0 - 5;
  const r = ox + c.x1 + 5;
  const rim = oy + c.rim - LIP;
  const floor = oy + c.floor + 5;
  g.strokeStyle = INK;
  g.lineWidth = 8;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(l, rim);
  g.lineTo(l, floor);
  g.lineTo(r, floor);
  g.lineTo(r, rim);
  g.stroke();
  // How many it holds: at rest, how many this box holds.
  g.lineWidth = 2.2;
  font.text(g, label, ox + (W - font.width(label, 18)) / 2, oy + c.floor + 30, 18);
}

/** One thing inside its circle of radius r, at `scale` of its size: a disc, a ring, a square or a pill. */
function thing(g, th, x, y, turn, scale) {
  const r = th.r;
  g.save();
  g.translate(x, y);
  g.rotate(turn);
  g.scale(scale, scale);
  g.fillStyle = th.fill;
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  if (th.kind === 0) {
    g.arc(0, 0, r - 1, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  } else if (th.kind === 1) {
    // A ring is a thick stroke with an ink edge either side.
    g.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    g.strokeStyle = INK;
    g.lineWidth = r * 0.52;
    g.stroke();
    g.strokeStyle = th.fill;
    g.lineWidth = r * 0.52 - 4;
    g.stroke();
  } else if (th.kind === 2) {
    const a = r * 0.7;
    g.roundRect(-a, -a, 2 * a, 2 * a, r * 0.18);
    g.fill();
    g.stroke();
  } else {
    const h = r * 0.48;
    g.moveTo(-r + h, -h);
    g.lineTo(r - h, -h);
    g.arc(r - h, 0, h, -Math.PI / 2, Math.PI / 2);
    g.lineTo(-r + h, h);
    g.arc(-r + h, 0, h, Math.PI / 2, Math.PI * 1.5);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.restore();
}
