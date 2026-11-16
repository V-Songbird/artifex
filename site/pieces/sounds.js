// The seams' sounds: small physical events of paper, water, glass, film and
// paint, which each seam piece places from its own state (see core/sound.js
// voice). A seam hears only what happens in it; its soundtrack ends on a short
// fade, because the shot after it may be silent. Materials sound as noise
// shaped in time (snap, knock, breath, swell), not as pitches: a sine held or
// repeated at one pitch is heard as a device. A seam's sound may carry an
// ambience (see ambience below), which the stage plays while it is scrolled.

'use strict';

const { voice, room, sumInto } = require('../../core/sound.js');
const { rng } = require('../../core/rand.js');
const P = require('./paper.js');

const hertz = (note) => 440 * 2 ** ((note - 69) / 12);

/** Where x (design units, the frame 0 to `w` wide) is heard, left to right. */
const panX = (x, w = P.W) => Math.max(-0.8, Math.min(0.8, ((x - w / 2) / (w / 2)) * 0.8));

/**
 * One small contact about `colour` hertz, dying away over `length` seconds: a
 * fibre giving, a grain of friction, a tap. It is a few inharmonic sine
 * partials under 8 kHz rather than a burst of noise, because a lossy codec
 * keeps a burst's band levels and not its waveform, and codes little above
 * that, so a film of it would not replay.
 */
const grain = (colour, length, level) => ({ pitch: colour, partials: [[1, 1], [1.47, 0.6], [2.09, 0.4], [2.83, 0.25]].filter(([r], i) => !i || r * colour < 8000), attack: 0.005, decay: 2.5 * length, damp: 0.6, level: level * 0.2 });

/** A breath of air or friction, `length` seconds of noise at `colour`, rising over `attack`. */
const breath = (colour, attack, length, level) => ({ pitch: colour, partials: [[1, 0]], attack, decay: 0.2, tail: { level: 1, colour, length }, level });

/**
 * One contact made of noise and no pitch: a fibre giving, a nib catching, a
 * click, a drop of grit. A band of noise about `colour` hertz falling to
 * silence over `length` seconds; a softer `velocity` is darker and shorter
 * in the ear, as voice makes it. AAC keeps a burst's band levels, not its
 * waveform, so a film voiced by sparse noise contacts does not replay: the
 * MP4 films of crack, portal, trace, print and fold, five of the seven early
 * seams, differ from their recipes on the soundtrack, one block decoding 10
 * to 23 dB from the render, under replay's 25 dB floor for AAC. `place`
 * builds it with `tick`, voice's transient alone, because a seam sounds
 * hundreds of them and voice would give each a silent body and 80 ms of tail.
 */
const snap = (colour, length, level) => ({ snap: { colour, length }, level });

/**
 * A `snap` spec's noise started at `at`, as voice makes its transient: rising
 * over 2 ms, falling to -60 dB over its length, then out over 2 ms; louder,
 * brighter and longer in the ear the harder its `velocity`, `vary` moving its
 * level up to 3 dB. Its output node, a stereo panner.
 */
function tick(ctx, R, name, at, { snap: { colour, length }, level = 1, velocity = 1, vary = 0, pan = 0, distance = 0 }) {
  const rate = ctx.sampleRate, fall = length * rate, fade = 0.002 * rate, rise = 0.002 * rate, n = Math.ceil(fall + fade);
  const loud = level * velocity * velocity * 10 ** (0.15 * vary * (2 * R(name, 'vary', 1) - 1)) * 10 ** (-0.75 * distance);
  const buf = ctx.createBuffer(1, n, rate), data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (2 * R(name, 'strike', i) - 1) * loud * Math.min(1, i / rise) * Math.exp((-Math.log(1000) * i) / fall) * (i <= fall ? 1 : Math.max(0, 1 - (i - fall) / fade));
  const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), place = ctx.createStereoPanner();
  src.buffer = buf;
  band.type = 'bandpass';
  band.frequency.value = Math.min(0.45 * rate, colour * (0.5 + velocity / 2));
  band.Q.value = 0.9;
  place.pan.value = pan;
  src.connect(band);
  if (distance > 0) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(16000 * (1 / 8) ** distance, 0.45 * rate);
    lp.Q.value = Math.SQRT1_2;
    band.connect(lp);
    lp.connect(place);
  } else band.connect(place);
  src.start(at);
  return place;
}

/**
 * A knock of wood, glass or card set down: a noise contact at `colour` over
 * a body of three inharmonic partials about `body` hertz that dies within a
 * tenth of a second, so it is heard as a thing struck and never as a note.
 */
const knock = (colour, body, level) => ({ pitch: body, partials: [[1, 0.18], [2.76, 0.07], [5.4, 0.03]], decay: 0.05, damp: 1, strike: { level: 1, colour, length: 0.02 }, level });

/**
 * A drop or a bubble breaking in water: a wet tick of noise with, under it,
 * the bubble's short chirp at `pitch` hertz rising `rise` cents as it dies
 * over `ring` seconds, as a closing bubble does; the tick louder than the
 * chirp, so it is heard as water and not as a beep.
 */
const drop = (pitch, ring, rise, level) => ({ pitch, partials: [[1, 0.45]], attack: 0.002, decay: ring, damp: 1, bend: [[0, 0], [ring, rise]], strike: { level: 1, colour: Math.min(6000, 2.2 * pitch), length: 0.004 }, level });

/**
 * A swell of air or water over `length` seconds from `at`: one stream of
 * noise about `colour(u)` hertz (u from 0 to 1 over the swell), its band
 * moved a little apart every 0.1 s, its level rising from silence to its
 * peak at share `peak` (above 0, at most 1) and falling back to silence, so
 * the sound grows and ebbs, which one voice's tail, falling from its start,
 * cannot. Under that arc the level wavers between seeded breaths every 40 ms,
 * as air does, never at an even beat. One stream, not overlapping voices,
 * keeps its build cheap: the stage builds it while the film plays. Returns
 * one [second, spec] pair, which `place` builds with `gust`; give it a place
 * (`pan`, `distance`, `sweep`) with `placed`.
 */
function swell(R, name, at, length, colour, level, peak = 0.5) {
  return [[at, { swell: { length, colour, peak, name }, level }]];
}

// Two seconds of seeded noise per context, which every swell on it reads from its own seeded place.
const noises = new WeakMap();
function noise(ctx, R) {
  let buf = noises.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = 2 * R('swell', 'noise', i) - 1;
    noises.set(ctx, buf);
  }
  return buf;
}

/** The noise stream of a `swell` spec started at `at`; its output node, a stereo panner. */
function gust(ctx, R, _, at, { swell: { length, colour, peak, name }, level, pan = 0, distance = 0, sweep }) {
  const arc = (u) => { const e = u <= peak ? Math.sin((Math.PI / 2) * (u / peak)) : Math.cos((Math.PI / 2) * ((u - peak) / (1 - peak))); return e * e; };
  // About the level of the overlapping breaths this stream replaced; its level read every 10 ms.
  const rate = ctx.sampleRate, loud = 0.5 * level * 10 ** (-0.75 * distance), steps = Math.max(1, Math.ceil(length / 0.04)), n = Math.max(2, Math.ceil(length / 0.01) + 1);
  const breaths = Array.from({ length: steps + 1 }, (_, j) => 0.55 + 0.45 * R(name, 'breath', j));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), k = u * steps, j = Math.min(steps - 1, Math.floor(k)), f = k - j, s = f * f * (3 - 2 * f);
    curve[i] = loud * arc(u) * (breaths[j] + (breaths[j + 1] - breaths[j]) * s);
  }
  const src = ctx.createBufferSource(), shape = ctx.createGain(), band = ctx.createBiquadFilter();
  src.buffer = noise(ctx, R);
  src.loop = true;
  shape.gain.value = 0;
  shape.gain.setValueCurveAtTime(curve, at, length);
  src.connect(shape);
  band.type = 'bandpass';
  band.Q.value = 0.6;
  const moves = Math.max(1, Math.ceil(length / 0.1));
  band.frequency.value = colour(0);
  band.frequency.setValueAtTime(colour(0), at);
  for (let j = 1; j <= moves; j++) band.frequency.linearRampToValueAtTime(Math.min(0.45 * rate, colour(j / moves) * (0.85 + 0.3 * R(name, 'colour', j))), at + (j / moves) * length);
  shape.connect(band);
  src.start(at, src.buffer.duration * R(name, 'from', 0));
  src.stop(at + length);
  const chain = [band];
  const lowpass = (corner) => { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = corner; lp.Q.value = Math.SQRT1_2; chain.push(lp); return lp; };
  if (sweep) {
    const lp = lowpass(sweep[0][1]);
    lp.frequency.setValueAtTime(sweep[0][1], at);
    for (const [t, hz] of sweep) lp.frequency.exponentialRampToValueAtTime(hz, at + t);
  }
  if (distance > 0) lowpass(Math.min(16000 * (1 / 8) ** distance, 0.45 * rate));
  const place = ctx.createStereoPanner();
  place.pan.value = pan;
  chain.push(place);
  for (let k = 1; k < chain.length; k++) chain[k - 1].connect(chain[k]);
  return place;
}

// The kaleidoscope's detent: it clicks each time it has turned this far, in radians (the bend and the portal count on).
const DETENT = 0.02;

/**
 * One click of the turning kaleidoscope's ratchet, as hard as it is turning
 * fast (radians a second): a dry click of its tube, coloured a little apart
 * each time by `j`, never one pitch repeated.
 */
const detent = (speed, j, R) => ({
  ...knock(1800 + 2000 * R('detent', 'colour', j), 300 + 600 * R('detent', 'body', j), 0.07), partials: [[1, 0.06], [2.76, 0.03]],
  velocity: Math.min(1, 0.3 + 2.2 * speed) * (0.5 + 0.5 * R('detent', 'level', j)), vary: 0.8,
});

/**
 * Quiet events at seeded times over `loop` seconds, for a shot's ambience:
 * gaps of `every` seconds on average, drawn as chance draws them, so events
 * come alone or in small runs and never on a grid. `make(j, swell)` gives
 * event j's spec; `swell`, 0.2 to 1, rises and falls once over the loop from
 * a seeded phase, so the place breathes. Returns [second, spec] pairs.
 */
function scatter(R, name, loop, every, make) {
  const out = [], phase = R(name, 'phrase', 0);
  for (let j = 0, at = every * R(name, 'gap', 0); at < loop; j++, at -= every * Math.log(1 - 0.95 * R(name, 'gap', j + 1))) {
    out.push([at, make(j, 0.6 + 0.4 * Math.sin(2 * Math.PI * (at / loop + phase)))]);
  }
  return out;
}

/**
 * Grains along a movement from second `from` to `to` whose share done by
 * `u` of its time is `way(u)` (0 to 1): one each time it has gone `1 / count`
 * further, so they come thick while it moves fast and thin as it slows.
 * `make(u, speed, j)` gives each grain's spec, where speed is 1 at the
 * movement's mean pace; returns [second, spec] pairs.
 */
function along(from, to, count, way, make) {
  const out = [], n = 200;
  let next = 1 / count, j = 0;
  for (let i = 1; i <= n; i++) {
    const was = way((i - 1) / n), is = way(i / n), speed = (is - was) * n;
    while (is >= next - 1e-12 && next <= 1 + 1e-12) {
      const u = (i - 1 + (next - was) / Math.max(1e-9, is - was)) / n;
      out.push([from + u * (to - from), make(u, speed, j++)]);
      next += 1 / count;
    }
  }
  return out;
}

/**
 * Sum `voices` into the context's destination, dry and through a seeded room
 * of `size` seconds (`send` of it), and fade the whole out over the last
 * `fade` seconds of the soundtrack (a quarter by default), so it never ends
 * on a cut. An ambience, which the stage repeats, takes `fade: 0`.
 */
function mix(ctx, R, voices, { size = 1.2, send = 0.28, level = 0.9, bright = 6500, dark = 700, fade = 0.25 } = {}) {
  const dry = ctx.createGain(), out = ctx.createGain(), wet = ctx.createGain(), master = ctx.createGain();
  const hall = room(ctx, R, 'seam', { size, bright, dark });
  out.gain.value = level;
  wet.gain.value = send;
  sumInto(ctx, voices, dry);
  dry.connect(out);
  dry.connect(wet);
  wet.connect(hall);
  out.connect(master);
  hall.connect(master);
  const end = ctx.length / ctx.sampleRate;
  if (fade > 0) {
    master.gain.setValueAtTime(1, Math.max(0, end - fade));
    master.gain.linearRampToValueAtTime(0, end);
  }
  master.connect(ctx.destination);
}

/** Voices from [second, spec] pairs, each named `name` and its index, a `swell` spec built by `gust` and a `snap` by `tick`; those at or past `end` are left out. */
function place(ctx, R, name, pairs, end) {
  const out = [];
  pairs.forEach(([at, spec], i) => { if (at >= 0 && at < end) out.push((spec.swell ? gust : spec.snap ? tick : voice)(ctx, R, name + ' ' + i, at, spec)); });
  return out;
}

/**
 * A shot's ambience for the stage, which plays it while the shot is on
 * screen and the film is scrolled: `make(R, loop)` gives its events as
 * [second, spec] pairs, each moved into the first `loop` seconds (a swell
 * begun near the end goes on at the start), summed in a room of `size` and
 * sent to it generously, at `level`, and never faded out, because the stage
 * folds what rings past the loop back onto its start and repeats it. Returns
 * the function stage.js reads as `sound.ambience`; its `events(state, loop)`
 * gives the pairs it places, and `size` its room, for a test to read.
 */
function ambience(name, make, { size = 1.6, send = 0.5, level = 3 } = {}) {
  const events = (s, loop) => make(rng(s.seed), loop).map(([at, spec]) => [at % loop, spec]);
  const sum = (ctx, s, voices) => mix(ctx, rng(s.seed), voices, { size, send, level, fade: 0 });
  const build = (ctx, s, { loop }) => {
    const pairs = events(s, loop);
    if (typeof requestIdleCallback !== 'function') return sum(ctx, s, place(ctx, rng(s.seed), name, pairs, loop));
    // In a page the graph is built a few voices in each idle period, in the same order from the same
    // generator, so the scroll never waits for the whole of it; the stage renders once this resolves.
    return new Promise((resolve, reject) => {
      const R = rng(s.seed), voices = [];
      let i = 0;
      const some = (deadline) => {
        try {
          do {
            const [at, spec] = pairs[i];
            if (at >= 0 && at < loop) voices.push((spec.swell ? gust : spec.snap ? tick : voice)(ctx, R, name + ' ' + i, at, spec));
            i++;
          } while (i < pairs.length && deadline.timeRemaining() > 2);
          if (i < pairs.length) requestIdleCallback(some, { timeout: 250 });
          else requestIdleCallback(() => { try { resolve(sum(ctx, s, voices)); } catch (error) { reject(error); } }, { timeout: 250 });
        } catch (error) { reject(error); }
      };
      if (pairs.length) requestIdleCallback(some, { timeout: 250 });
      else resolve(sum(ctx, s, voices));
    });
  };
  return Object.assign(build, { events, size });
}

/** Each of `swells`, [second, spec] pairs, its breaths given `extra` (a place, a distance) as well. */
const placed = (swells, extra) => swells.map(([at, spec]) => [at, { ...spec, ...extra }]);

module.exports = { hertz, panX, grain, breath, snap, knock, drop, swell, placed, along, scatter, mix, place, ambience, DETENT, detent };
