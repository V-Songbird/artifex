// Voices for any subject, a seeded room, and summing them two at a time.
//
// Web Audio adds up everything connected to one input. Installed Edge adds a
// node's three or more inputs in an order that changes between renders, and
// floats added in another order round differently, so one graph renders samples
// that differ in their last bits. Two inputs add up the same either way round,
// so a graph whose every input takes at most two renders the same bytes each
// time in one browser. `voice` and `room` hold to that inside, and their
// noise comes from the seed, so a soundtrack built from them renders the same
// bytes every time too.

'use strict';

const { noise2 } = require('./rand.js');

/**
 * Connect every node in `nodes` to `into` through a balanced tree of gain nodes
 * at unity, each taking at most two inputs; `into` takes at most two of them, so
 * it must take no other input. The result is the sum one input would make,
 * always added in the same order. Each node's position in `nodes` fixes its
 * place in the tree; three or more nodes cost `nodes.length - 2` gain nodes.
 */
function sumInto(ctx, nodes, into) {
  let parts = nodes;
  if (nodes.length > 2) {
    const half = Math.ceil(nodes.length / 2);
    parts = [nodes.slice(0, half), nodes.slice(half)].map((part) => {
      if (part.length === 1) return part[0];
      const node = ctx.createGain();
      sumInto(ctx, part, node);
      return node;
    });
  }
  for (const n of parts) n.connect(into);
}

// -60 dB: where a decay counts as over. ln(1000) time constants reach it.
const QUIET = 1e-3;
const FALL = Math.log(1 / QUIET);
// Every layer ends on a linear fade this long from -60 dB, never a cut: a gain
// cut into silence is heard as a click, and a lossy codec smears it.
const FADE = 0.08;
// An ambience grain's fade from -60 dB is this long instead: already no click,
// and FADE would compute a 20 ms grain's sine for four times its ring.
const GRAIN_FADE = 0.005;

function need(who, name, v, ok, what) {
  if (!(typeof v === 'number' && Number.isFinite(v) && ok(v))) throw new RangeError(`${who}: ${name} must be ${what}, got ${String(v)}`);
}

// A group of keys such as `vibrato: { ... }`: an object, not null, a list or a number.
function group(who, name, v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new RangeError(`${who}: ${name} must be an object of its keys, got ${Array.isArray(v) ? 'a list' : String(v)}`);
}

// A list of [seconds, value] points in time order, each value passing `ok`.
function points(who, name, list, ok, what) {
  if (!Array.isArray(list) || list.length === 0) throw new RangeError(`${who}: ${name} must be a list of [seconds, value] points`);
  list.forEach((p, i) => {
    if (!Array.isArray(p)) throw new RangeError(`${who}: ${name} must be a list of [seconds, value] points`);
    need(who, `${name} time`, p[0], (v) => v >= (i ? list[i - 1][0] : 0), 'seconds, 0 or more and in order');
    need(who, `${name} value`, p[1], ok, what);
  });
}

// A rate of events that runs linearly between [seconds, rate] points and holds
// outside them, over its first `end` seconds: how many events it makes, and
// `at(share)`, the second by which `share` (0 to 1) of them have happened.
function density(list, end) {
  const last = list[list.length - 1];
  const spans = [[-Infinity, list[0][1], list[0][0], list[0][1]],
    ...list.slice(1).map(([t, r], i) => [list[i][0], list[i][1], t, r]), [last[0], last[1], Infinity, last[1]]];
  const parts = [];
  let total = 0;
  for (const [a, ra, b, rb] of spans) {
    const rate = (t) => (ra === rb ? ra : ra + ((rb - ra) * (t - a)) / (b - a));
    const [from, to] = [Math.max(a, 0), Math.min(b, end)];
    if (!(to > from)) continue;
    const part = { from, len: to - from, r0: rate(from), r1: rate(to) };
    part.area = ((part.r0 + part.r1) * part.len) / 2;
    total += part.area;
    parts.push(part);
  }
  const live = parts.filter((p) => p.area > 0);
  const at = (share) => {
    let rem = share * total;
    for (const [i, p] of live.entries()) {
      if (rem > p.area && i < live.length - 1) { rem -= p.area; continue; }
      // Solve r0 t + (r1 - r0) t^2 / (2 len) = rem in a form that holds when either term is 0.
      const slope = (p.r1 - p.r0) / (2 * p.len);
      const t = rem > 0 ? (2 * rem) / (p.r0 + Math.sqrt(Math.max(0, p.r0 * p.r0 + 4 * slope * rem))) : 0;
      return p.from + Math.min(t, p.len);
    }
    return 0;
  };
  return { total, at };
}

/**
 * One sound in three layers, started at `at` seconds on the context's clock,
 * for any subject: a transient, a body and a tail. Returns its output node, a
 * stereo panner; sum it with others through `sumInto`.
 *
 * - The **transient** is a burst of seeded noise through a band at `strike.colour`
 *   hertz, falling to -60 dB over `strike.length` seconds: the contact that starts
 *   the sound. Off at `strike.level` 0.
 * - The **body** is sine partials at `pitch` times each ratio in `partials`,
 *   `[ratio, level]` pairs, rising over `attack`, holding for `hold`, then each
 *   falling to -60 dB over `decay / ratio ** damp` seconds, so higher partials die
 *   sooner as they do in struck and plucked things (`damp` 0: all together).
 *   `detune` cents splits every partial into two, that far apart, which beat.
 *   A partial at level 0 builds no oscillator. A silent voice, at `level` or
 *   `velocity` 0, builds nothing at all. A silent body, every partial at level 0
 *   or the voice silent, may leave out `pitch`, and a tail over a silent body
 *   of a sounding voice then needs its own `tail.colour`.
 * - The **tail** is seeded noise through a wide band at `tail.colour` hertz
 *   (default `pitch`), rising with the body's attack while it falls to -60 dB
 *   over `tail.length` seconds from its start: the air a sound leaves. Off at
 *   `tail.level` 0. `tail.rise` seconds, when given, swells it over that long
 *   instead and starts its fall at the peak, so it lasts `rise + length`.
 *
 * Levels are linear; `level` scales all three and `pan` places the voice, or,
 * as `[[seconds, pan], ...]` in time order after `at`, moves it across the
 * field, linearly between them, holding the first before and the last after.
 * `velocity`, from 0 to 1, is how hard the sound is started: it scales the
 * level, and a softer start is also darker, as struck and blown things are:
 * each partial above the first is scaled again by `velocity ** ((ratio - 1) / 2)`,
 * and the transient by `velocity` again, its band lowered to `0.5 + velocity / 2`
 * of its colour. `vary`, from 0 to 1, makes each voice a little different from
 * the next, from its name: up to `vary` times 12 cents of pitch, 3 dB of level,
 * 20% of decay and 2 dB of each partial, as no two real strokes are alike.
 *
 * A note can move while it sounds. Each of these is off unless given, and its
 * times are seconds after `at`:
 * - `bend`, `[[seconds, cents], ...]` in time order: the body's pitch glides
 *   through those offsets, linearly in cents, holding the first before it and
 *   the last after it: a fall into the note, a rise, a sag as it dies.
 * - `vibrato`, `{ depth, rate, delay, rise }`: the body's pitch swings `depth`
 *   cents either way `rate` times a second (default 5), from `delay` seconds
 *   (default 0), growing to its full depth over `rise` (default 0.3). `vary`
 *   moves its rate by up to `vary` times 10%.
 * - `sweep`, `[[seconds, hertz], ...]` in time order: a low-pass over the whole
 *   voice whose corner moves through those frequencies, exponentially between
 *   them, so the sound opens and closes as it goes.
 * - `distance`, from 0 (near) to 1 (far): the voice is up to 15 dB quieter and
 *   heard through air, a low-pass from 16 kHz a little away down to 2 kHz at 1,
 *   as distance takes the highs first. Send a far voice more to the room.
 * - `fm`, `{ ratio, index }`: frequency modulation at audio rate. Each partial's
 *   pitch swings by `index` (0 to 20) times a modulator at `ratio` (default 1,
 *   above 0, at most 16) times that partial, which bends and swings with it, so
 *   the partial grows sidebands `ratio` times its frequency apart, more and
 *   louder as `index` grows: a whole ratio keeps its harmonics, a simple
 *   fraction such as 0.5 makes a series under it, and others clang. The
 *   swing follows the partial's envelope, so the sound darkens as it dies.
 *   Past half the sample rate, about `index + 1` sidebands up, they fold back.
 * - `highpass`, `{ peak, rest }`: a high-pass over the whole voice whose corner
 *   follows its envelope: from `rest` hertz (default 20) up to `peak` over the
 *   attack, held, then back to `rest` over `decay`, exponentially, so the attack
 *   is thin and the lows bloom as it dies. Butterworth: flat, no resonance.
 *
 * Every layer fades out over 80 ms from -60 dB and stops, so nothing clicks. The
 * noise and variation are `R(name, 'strike' | 'tail' | 'vary' | 'vibrato', index)`:
 * give each voice its own `name`.
 */
function voice(ctx, R, name, at, spec) {
  const who = `voice ${name}`;
  group(who, 'spec', spec);
  const {
    pitch, partials = [[1, 1]], detune = 0, attack = 0.005, hold = 0, decay = 1, damp = 0.5,
    strike = {}, tail = {}, level = 1, pan = 0, velocity = 1, vary = 0,
    bend, vibrato, sweep, distance = 0, fm, highpass,
  } = spec;
  need(who, 'at', at, (v) => v >= 0, 'a time in seconds, 0 or later');
  need(who, 'attack', attack, (v) => v > 0, 'seconds above 0');
  need(who, 'hold', hold, (v) => v >= 0, 'seconds, 0 or more');
  need(who, 'decay', decay, (v) => v > 0, 'seconds above 0');
  need(who, 'damp', damp, (v) => v >= 0, '0 or more');
  need(who, 'detune', detune, (v) => v >= 0, 'cents, 0 or more');
  need(who, 'level', level, (v) => v >= 0, 'a linear level, 0 or more');
  if (Array.isArray(pan)) points(who, 'pan', pan, (v) => v >= -1 && v <= 1, 'from -1 to 1');
  else need(who, 'pan', pan, (v) => v >= -1 && v <= 1, 'from -1 to 1');
  need(who, 'velocity', velocity, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  need(who, 'vary', vary, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  if (!Array.isArray(partials) || partials.length === 0) throw new RangeError(`${who}: partials must be a list of [ratio, level] pairs`);
  partials.forEach((p, i) => {
    if (!Array.isArray(p)) throw new RangeError(`${who}: partial ${i} must be a [ratio, level] pair, got ${String(p)}`);
    need(who, `partial ${i} ratio`, p[0], (v) => v > 0, 'above 0');
    need(who, `partial ${i} level`, p[1], (v) => v >= 0, 'a linear level, 0 or more');
  });
  group(who, 'strike', strike);
  group(who, 'tail', tail);
  need(who, 'distance', distance, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  const nyquist = ctx.sampleRate / 2;
  if (bend !== undefined) points(who, 'bend', bend, () => true, 'cents');
  if (sweep !== undefined) points(who, 'sweep', sweep, (v) => v > 0 && v < nyquist, 'a frequency in hertz under half the sample rate');
  let fmRatio = 1, index = 0;
  if (fm !== undefined) {
    group(who, 'fm', fm);
    ({ ratio: fmRatio = 1, index } = fm);
    need(who, 'fm.ratio', fmRatio, (v) => v > 0 && v <= 16, 'above 0, at most 16');
    need(who, 'fm.index', index, (v) => v >= 0 && v <= 20, 'from 0 to 20');
  }
  if (highpass !== undefined) {
    group(who, 'highpass', highpass);
    const { peak, rest = 20 } = highpass;
    need(who, 'highpass.peak', peak, (v) => v > 0 && v < nyquist, 'a frequency in hertz under half the sample rate');
    need(who, 'highpass.rest', rest, (v) => v > 0 && v <= peak, 'a frequency in hertz above 0, at most highpass.peak');
  }

  // This voice's own deviation, each in [-vary, vary].
  const dev = (k) => vary * (2 * R(name, 'vary', k) - 1);
  const cents = 12 * dev(0);
  const loud = level * velocity * 10 ** (0.15 * dev(1)) * 10 ** (-0.75 * distance);
  const fall = decay * (1 + 0.2 * dev(2));
  const layers = [];
  const top = at + attack + hold;

  // One slow oscillator swings every partial's pitch together.
  let lfo = null;
  let swing = null;
  if (vibrato !== undefined) {
    group(who, 'vibrato', vibrato);
    const { depth, rate = 5, delay = 0, rise = 0.3 } = vibrato;
    need(who, 'vibrato.depth', depth, (v) => v >= 0 && v <= 1200, 'cents from 0 to 1200');
    need(who, 'vibrato.rate', rate, (v) => v > 0 && v <= 20, 'hertz above 0, at most 20');
    need(who, 'vibrato.delay', delay, (v) => v >= 0, 'seconds, 0 or more');
    need(who, 'vibrato.rise', rise, (v) => v > 0, 'seconds above 0');
  }
  // A partial whose peak is 0, at its own level 0 or the voice's, builds nothing.
  const builds = (amount) => loud * amount !== 0;
  // A voice that builds no partial needs no pitch; one that builds any does.
  const sounding = partials.some((p) => builds(p[1]));
  if (pitch !== undefined || sounding) need(who, 'pitch', pitch, (v) => v > 0, 'a frequency in hertz above 0');
  if (vibrato !== undefined && sounding) {
    const { depth, rate = 5, delay = 0, rise = 0.3 } = vibrato;
    lfo = ctx.createOscillator();
    lfo.frequency.value = rate * (1 + 0.1 * vary * (2 * R(name, 'vibrato', 0) - 1));
    swing = ctx.createGain();
    swing.gain.value = 0;
    swing.gain.setValueAtTime(0, at + delay);
    swing.gain.linearRampToValueAtTime(depth, at + delay + rise);
    lfo.connect(swing);
    lfo.start(at + delay);
  }
  let end = at;

  for (const [i, [ratio, amount]] of partials.entries()) {
    // Its index still keys its variation when another partial is skipped.
    if (!builds(amount)) continue;
    const gone = top + fall / ratio ** damp;
    end = Math.max(end, gone + FADE);
    const env = ctx.createGain();
    const peak = loud * amount * 10 ** (0.1 * dev(3 + i)) * velocity ** (Math.max(0, ratio - 1) / 2);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + attack);
    env.gain.setValueAtTime(peak, top);
    env.gain.exponentialRampToValueAtTime(Math.max(peak * QUIET, 1e-9), gone);
    env.gain.linearRampToValueAtTime(0, gone + FADE);
    const spread = detune > 0 ? [-detune / 2, detune / 2] : [0];
    const oscs = spread.map((apart) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = pitch * ratio;
      osc.detune.value = cents + apart;
      if (bend) {
        osc.detune.value = cents + apart + bend[0][1];
        osc.detune.setValueAtTime(cents + apart + bend[0][1], at);
        for (const [t, c] of bend) osc.detune.linearRampToValueAtTime(cents + apart + c, at + t);
      }
      if (swing) swing.connect(osc.detune);
      osc.start(at);
      osc.stop(gone + FADE);
      return osc;
    });
    // Two copies at half level each keep a partial's level where they agree.
    const into = oscs.length > 1 ? ctx.createGain() : env;
    if (oscs.length > 1) { into.gain.value = 0.5; into.connect(env); }
    sumInto(ctx, oscs, into);
    layers.push(env);
    if (index > 0) {
      // One modulator for both copies, moved as they are, so its ratio holds;
      // its swing in hertz is index times its frequency, shaped as the partial.
      const hz = pitch * ratio * fmRatio;
      const mod = ctx.createOscillator();
      mod.frequency.value = hz;
      mod.detune.value = cents + (bend ? bend[0][1] : 0);
      if (bend) {
        mod.detune.setValueAtTime(cents + bend[0][1], at);
        for (const [t, c] of bend) mod.detune.linearRampToValueAtTime(cents + c, at + t);
      }
      if (swing) swing.connect(mod.detune);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, at);
      depth.gain.linearRampToValueAtTime(index * hz, at + attack);
      depth.gain.setValueAtTime(index * hz, top);
      depth.gain.exponentialRampToValueAtTime(index * hz * QUIET, gone);
      depth.gain.linearRampToValueAtTime(0, gone + FADE);
      mod.connect(depth);
      for (const osc of oscs) depth.connect(osc.frequency);
      mod.start(at);
      mod.stop(gone + FADE);
    }
  }
  if (lfo) lfo.stop(end);

  // `swell` 0: the fall runs from the start, under the rise; otherwise it waits
  // for the rise, and the layer lasts `rise + length`.
  const burst = (part, opts, rise, length, colour, q, touch, swell = 0) => {
    const amount = opts.level === undefined ? 0 : opts.level;
    need(who, `${part}.level`, amount, (v) => v >= 0, 'a linear level, 0 or more');
    if (amount === 0 || loud * touch === 0) return;
    need(who, `${part}.length`, length, (v) => v > 0, 'seconds above 0');
    need(who, `${part}.colour`, colour, (v) => v > 0 && v < ctx.sampleRate / 2, 'a frequency in hertz under half the sample rate');
    const rate = ctx.sampleRate;
    const n = Math.ceil((swell + length + FADE) * rate);
    const buf = ctx.createBuffer(1, n, rate);
    const data = buf.getChannelData(0);
    const riseN = rise * rate;
    const waitN = swell * rate;
    const fallN = length * rate;
    const fadeN = FADE * rate;
    for (let i = 0; i < n; i++) {
      // Rise linearly, fall to -60 dB by `length` after any swell, then fade to nothing.
      const up = riseN > 0 ? Math.min(1, i / riseN) : 1;
      const down = Math.exp((-FALL * Math.max(0, i - waitN)) / fallN);
      const out = i <= waitN + fallN ? 1 : Math.max(0, 1 - (i - waitN - fallN) / fadeN);
      data[i] = (2 * R(name, part, i) - 1) * up * down * out * loud * touch * amount;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = colour;
    band.Q.value = q;
    src.connect(band);
    src.start(at);
    layers.push(band);
  };
  burst('strike', strike, 0.002, strike.length === undefined ? 0.03 : strike.length,
    (strike.colour === undefined ? 3000 : strike.colour) * (0.5 + velocity / 2), 0.9, velocity);
  if (tail.rise !== undefined) need(who, 'tail.rise', tail.rise, (v) => v > 0, 'seconds above 0');
  burst('tail', tail, tail.rise === undefined ? attack : tail.rise, tail.length === undefined ? 1.5 : tail.length,
    tail.colour === undefined ? pitch : tail.colour, 0.6, 1, tail.rise);

  // The voice's own filters, in order: its high-pass, its sweep, then the air it crosses.
  const place = ctx.createStereoPanner();
  if (Array.isArray(pan)) {
    place.pan.value = pan[0][1];
    place.pan.setValueAtTime(pan[0][1], at);
    for (const [t, p] of pan) place.pan.linearRampToValueAtTime(p, at + t);
  } else place.pan.value = pan;
  const lowpass = (corner) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = corner;
    // Web Audio reads a low-pass Q in dB too: a linear 0.707 would peak 1.7 dB under the corner.
    f.Q.value = 20 * Math.log10(Math.SQRT1_2);
    return f;
  };
  const chain = [];
  if (highpass) {
    const { peak, rest = 20 } = highpass;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    // Web Audio reads a high-pass Q in dB: -3 dB is Butterworth, flat to its corner.
    f.Q.value = 20 * Math.log10(Math.SQRT1_2);
    f.frequency.value = rest;
    f.frequency.setValueAtTime(rest, at);
    f.frequency.exponentialRampToValueAtTime(peak, at + attack);
    f.frequency.setValueAtTime(peak, top);
    f.frequency.exponentialRampToValueAtTime(rest, top + fall);
    chain.push(f);
  }
  if (sweep) {
    const f = lowpass(sweep[0][1]);
    f.frequency.setValueAtTime(sweep[0][1], at);
    for (const [t, hz] of sweep) f.frequency.exponentialRampToValueAtTime(hz, at + t);
    chain.push(f);
  }
  if (distance > 0) chain.push(lowpass(Math.min(16000 * (1 / 8) ** distance, 0.45 * ctx.sampleRate)));
  chain.push(place);
  sumInto(ctx, layers, chain[0]);
  for (let k = 1; k < chain.length; k++) chain[k - 1].connect(chain[k]);
  return place;
}

/**
 * The sound of a place, for any subject, started at `at` seconds and lasting
 * `length`: a bed of seeded noise in a band that never holds still, and a
 * texture of small seeded events in the same band, such as drops, bubbles,
 * crackle or distant steps. Returns a buffer source; sum it with voices
 * through `sumInto`. A place is mostly its events: keep the bed low and dark.
 *
 * The band is centred on `colour` hertz (default 800) and `band` octaves wide
 * (default 2). Its colour wanders up to `drift` octaves either way and each
 * side's bed level up to `drift` times 6 dB, smoothly, about `pace` times a
 * second (defaults 0.5 and 0.3), as wind, water and traffic do. `level` is the
 * bed's RMS at its colour, linear (default 0.05; 0 leaves it out). Each side is
 * its own noise, so the bed is wide rather than a point. `tint` is the bed's
 * noise before its band: 'white' (default), 'pink', 3 dB less each octave up,
 * or 'brown', 6 dB less above about sr / 1250 hertz (38 at 48 kHz) and flatter
 * below, so a wide bed sounds softer and less hissy; its level
 * is still its RMS. Grains are never tinted.
 *
 * `grains`, when given, adds `grains.rate` events a second at seeded times:
 * each a sine at a seeded pitch in the band, rising `grains.chirp` octaves
 * (default 0) as it falls to -60 dB over `grains.length` seconds (default
 * 0.02), as a closing bubble does, then fading out over 5 ms. Each is set at
 * `grains.level`, less a seeded 0 to `grains.spread` dB (default 12), at a
 * seeded place across the two sides. Its 1 ms rise meets its fall, so it peaks
 * under that level: by e^(-6.9 ms / length) from 6.9 ms up (-3 dB at 20 ms)
 * and by length / 18.8 ms below (-16 dB at 3 ms, -25.5 dB at 1 ms). Its sine
 * starts at 0, so a pitch whose quarter cycle outlasts the envelope's peak, at
 * 1 ms from 6.9 ms up and at length / 6.9 below, peaks lower still: under about
 * 250 Hz at any length, and higher for a shorter grain. Raise the level by as
 * much for a short grain. `grains.noise: true` makes each grain seeded noise
 * through a one-octave band at that pitch instead, gliding with the chirp, with
 * the same time, place and envelope and, its band full from its first sample,
 * the power of a sine held at its level: within 0.5 dB of the sine grain from
 * 1 kHz up at 2 ms and longer (0.9 dB under at 1 ms), above it at low pitch
 * where the sine barely rises (+13 dB for a 1 ms grain at 100 Hz, +5 dB at
 * 3 ms) and up to 1.3 dB under it around 300 Hz, where the sine's first peak
 * meets the envelope's: a dry tick where a sine reads as wet. `grains.rate` may
 * instead be a list of [seconds, events a second] points from the ambience's
 * start, as rain that builds and thins: the rate runs linearly between them
 * and holds outside them, and the events fall where it is dense. A plain
 * number keeps the uniform times it always gave.
 *
 * Everything rises over `fade` seconds (default 1, at least 80 ms) from silence
 * and falls back to silence over the same, so it never starts or stops on a cut.
 * The noise is `R(name, 'bed left' | 'bed right', index)`, apart from a room's, each event
 * `R(name, 'grain', 4 * event + 0..3)`, noise grains' one shared second of noise
 * (for grains over 0.895 s, a grain with its fade and 0.1 s more)
 * `R(name, 'grain noise', index)` read from `R(name, 'grain offset', event)`, and the wandering
 * `noise2(R, seconds * pace, row, name + ' drift')`.
 */
function ambience(ctx, R, name, at, spec) {
  const who = `ambience ${name}`;
  group(who, 'spec', spec);
  const { length, colour = 800, band = 2, level = 0.05, drift = 0.5, pace = 0.3, fade = 1, tint = 'white', grains } = spec;
  const sr = ctx.sampleRate;
  need(who, 'at', at, (v) => v >= 0, 'a time in seconds, 0 or later');
  need(who, 'fade', fade, (v) => v >= FADE, `seconds, at least ${FADE}`);
  need(who, 'length', length, (v) => v >= 2 * fade, 'seconds, at least twice its fade');
  need(who, 'colour', colour, (v) => v > 0 && v < 0.45 * sr, 'a frequency in hertz under 0.45 of the sample rate');
  need(who, 'band', band, (v) => v > 0 && v <= 8, 'octaves above 0, at most 8');
  need(who, 'level', level, (v) => v >= 0, 'a linear level, 0 or more');
  need(who, 'drift', drift, (v) => v >= 0 && v <= 2, 'octaves from 0 to 2');
  need(who, 'pace', pace, (v) => v > 0 && v <= 10, 'hertz above 0, at most 10');
  // How many 3 dB an octave the bed's noise falls by before its band-passes.
  const tilt = ['white', 'pink', 'brown'].indexOf(tint);
  if (tilt < 0) throw new RangeError(`${who}: tint must be 'white', 'pink' or 'brown', got ${String(tint)}`);

  const n = Math.ceil(length * sr);
  const buf = ctx.createBuffer(2, n, sr);
  // 1 / Q of each of two band-passes that together are `band` octaves wide.
  const k = (2 ** band - 1) / 2 ** (band / 2) / Math.sqrt(Math.SQRT2 - 1);
  const fadeN = fade * sr;
  const wander = (row, i) => 2 * noise2(R, (i / sr) * pace, row, `${name} drift`) - 1;
  const faded = (i) => (i >= fadeN && n - 1 - i >= fadeN ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.min(i / fadeN, (n - 1 - i) / fadeN)));
  if (level > 0) ['bed left', 'bed right'].forEach((side, c) => {
    const data = buf.getChannelData(c);
    // Two state-variable band-passes in a row (Zavalishin's), stable at any corner and
    // steep enough that the band, not the hiss around it, is heard; retuned every 32 samples.
    const st = [0, 0, 0, 0];
    let a1 = 0, a2 = 0, a3 = 0, keep = 0, gain = 0;
    let power = 0;
    // Pink: the white noise plus three one-pole low-passes of it, whose spread
    // corners lean the sum about 3 dB an octave (measured from 100 Hz to 12.8 kHz
    // at 48 kHz). Brown: one leaky integrator of it, 6 dB an octave above about
    // sr / 1250. The level below sets either's loudness.
    const pole = [0, 0, 0];
    let leak = 0;
    for (let i = 0; i < n; i++) {
      if (i % 32 === 0) {
        const hz = Math.min(colour * 2 ** (drift * wander(0, i)), 0.45 * sr);
        const g = Math.tan((Math.PI * hz) / sr);
        a1 = 1 / (1 + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
        // Equal loudness across its wandering: a wider band in hertz holds more power.
        // Pink holds the same power in each octave, brown more in a lower one.
        keep = Math.sqrt((colour / hz) ** (1 - tilt));
        gain = 10 ** (0.3 * drift * wander(1 + c, i));
      }
      let y = 2 * R(name, side, i) - 1;
      if (tilt === 1) {
        pole[0] = 0.99765 * pole[0] + 0.099046 * y;
        pole[1] = 0.963 * pole[1] + 0.2965164 * y;
        pole[2] = 0.57 * pole[2] + 1.0526913 * y;
        y = pole[0] + pole[1] + pole[2] + 0.1848 * y;
      } else if (tilt === 2) y = leak = 0.995 * leak + 0.1 * y;
      for (let j = 0; j < 4; j += 2) {
        const v3 = y - st[j + 1];
        const v1 = a1 * st[j] + a2 * v3;
        const v2 = st[j + 1] + a2 * st[j] + a3 * v3;
        st[j] = 2 * v1 - st[j];
        st[j + 1] = 2 * v2 - st[j + 1];
        y = k * v1;
      }
      y *= keep;
      power += y * y;
      data[i] = y * gain * faded(i);
    }
    const scale = power > 0 ? level / Math.sqrt(power / n) : 0;
    for (let i = 0; i < n; i++) data[i] *= scale;
  });

  if (grains !== undefined) {
    group(who, 'grains', grains);
    const { rate: many, length: ring = 0.02, chirp = 0, level: peak, spread = 12, noise = false } = grains;
    const curve = Array.isArray(many);
    if (curve) points(who, 'grains.rate', many, (v) => v >= 0 && v <= 2000, 'events a second from 0 to 2000');
    else need(who, 'grains.rate', many, (v) => v > 0 && v <= 2000, 'events a second above 0, at most 2000');
    need(who, 'grains.length', ring, (v) => v > 0 && v <= 2 && Math.ceil(v * sr) + Math.ceil(GRAIN_FADE * sr) < n,
      `seconds above 0, at most 2, and at least ${GRAIN_FADE} s shorter than the ambience`);
    need(who, 'grains.chirp', chirp, (v) => v >= -4 && v <= 4, 'octaves from -4 to 4');
    need(who, 'grains.level', peak, (v) => v >= 0, 'a linear level, 0 or more');
    need(who, 'grains.spread', spread, (v) => v >= 0 && v <= 60, 'dB from 0 to 60');
    if (typeof noise !== 'boolean') throw new RangeError(`${who}: grains.noise must be true or false, got ${String(noise)}`);
    const ringN = Math.ceil(ring * sr);
    const lastN = ringN + Math.ceil(GRAIN_FADE * sr);
    // Noise grains share one second of seeded noise, longer if a grain and its
    // 0.1 s of pre-roll outlast it, each read from its own seeded place.
    const preMax = Math.ceil(0.1 * sr);
    const hissN = Math.max(sr, lastN + preMax);
    const hiss = noise && Float32Array.from({ length: hissN }, (_, i) => 2 * R(name, 'grain noise', i) - 1);
    const riseN = Math.ceil(0.001 * sr);
    const fall = Math.exp(-FALL / ringN);
    const step = 2 ** (chirp / ringN);
    const [left, right] = [buf.getChannelData(0), buf.getChannelData(1)];
    // A plain rate places its events uniformly; a curve places them where it is dense.
    const count = Math.round(curve ? density(many, length).total : many * length);
    const place = curve && density(many, (n - lastN) / sr).at;
    for (let e = 0; e < count; e++) {
      const G = (k) => R(name, 'grain', 4 * e + k);
      const start = curve ? Math.min(n - lastN - 1, Math.floor(place(G(0)) * sr)) : Math.floor(G(0) * (n - lastN));
      // Its pitch sits in the band around the colour of the moment, and stays under the top once it has risen.
      const from = Math.min(colour * 2 ** (drift * wander(0, start) + band * (G(1) - 0.5)), (0.45 * sr) / 2 ** Math.max(0, chirp));
      const amp = peak * 10 ** ((-spread * G(2)) / 20);
      const [l, r] = [Math.cos((Math.PI / 2) * G(3)), Math.sin((Math.PI / 2) * G(3))];
      let hz = from, phase = 0, env = amp;
      // A noise grain is that noise through a one-octave band-pass at its pitch
      // (the bed's filter, 1 / Q = 1 / sqrt 2), scaled to a sine's power at its
      // level: seeded uniform noise (variance 1/3) through it, output v1 / sqrt 2,
      // has a variance of g a1 / (3 sqrt 2). The filter first runs two cycles of
      // its pitch (at most 0.1 s) on the noise before the grain, so the band is
      // full from the grain's first sample.
      const off = noise && Math.floor(R(name, 'grain offset', e) * hissN);
      let s1 = 0, s2 = 0, a1 = 0, a2 = 0, a3 = 0, keep = 0;
      const tune = () => {
        const g = Math.tan((Math.PI * hz) / sr);
        a1 = 1 / (1 + g * (g + Math.SQRT1_2));
        a2 = g * a1;
        a3 = g * a2;
        keep = Math.sqrt(3 / (Math.SQRT2 * g * a1));
      };
      const pass = (x) => {
        const v3 = x - s2;
        const v1 = a1 * s1 + a2 * v3;
        const v2 = s2 + a2 * s1 + a3 * v3;
        s1 = 2 * v1 - s1;
        s2 = 2 * v2 - s2;
        return v1;
      };
      if (noise) {
        tune();
        const preN = Math.min(preMax, Math.ceil((2 * sr) / hz));
        for (let i = -preN; i < 0; i++) pass(hiss[(off + i + hissN) % hissN]);
      }
      for (let i = 0; i < lastN; i++) {
        let wave;
        if (noise) {
          // Retuned as its pitch glides.
          if (chirp && i <= ringN) tune();
          wave = Math.SQRT1_2 * pass(hiss[(off + i) % hissN]) * keep;
        } else wave = Math.sin(phase);
        const v = env * (i < riseN ? i / riseN : 1) * (i <= ringN ? 1 : 1 - (i - ringN) / (lastN - ringN)) * faded(start + i) * wave;
        left[start + i] += l * v;
        right[start + i] += r * v;
        phase += (2 * Math.PI * hz) / sr;
        if (i < ringN) { hz *= step; env *= fall; }
      }
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.start(at);
  return src;
}

/**
 * A room a soundtrack plays in: a convolver whose impulse is seeded noise, one
 * independent channel each side, falling to -60 dB over `size` seconds after a
 * `predelay`, and darkening as it falls, from `bright` hertz to `dark`, as air
 * and walls take the highs first. `early` reflections land in its first 60 ms.
 * The impulse is `R(name, 'left' | 'right' | 'early', index)`, so another seed
 * is another room of the same size.
 *
 * Returns the convolver: feed it one send, or sum several into it with
 * `sumInto`, and connect it beside the dry signal. It is wet only. The browser
 * normalizes the impulse's power, so `size` changes the room, not its level.
 */
function room(ctx, R, name, opts = {}) {
  const who = `room ${name}`;
  group(who, 'opts', opts);
  const { size = 1.6, predelay = 0.012, bright = 7000, dark = 900, early = 6 } = opts;
  const rate = ctx.sampleRate;
  need(who, 'size', size, (v) => v > 0 && v <= 10, 'seconds above 0, at most 10');
  need(who, 'predelay', predelay, (v) => v >= 0 && v <= 0.2, 'seconds from 0 to 0.2');
  need(who, 'bright', bright, (v) => v > 0 && v < rate / 2, 'a frequency in hertz under half the sample rate');
  need(who, 'dark', dark, (v) => v > 0 && v <= bright, 'a frequency in hertz above 0, at most bright');
  need(who, 'early', early, (v) => Number.isInteger(v) && v >= 0 && v <= 64, 'a whole number from 0 to 64');
  const start = Math.round(predelay * rate);
  const n = start + Math.ceil(size * rate);
  const buf = ctx.createBuffer(2, n, rate);
  ['left', 'right'].forEach((side, c) => {
    const data = buf.getChannelData(c);
    let y = 0;
    for (let i = start; i < n; i++) {
      const u = (i - start) / (n - start);
      // One pole whose corner slides from bright to dark as the room decays.
      const a = Math.exp((-2 * Math.PI * bright * (dark / bright) ** u) / rate);
      y = (1 - a) * (2 * R(name, side, i) - 1) + a * y;
      data[i] = y * Math.exp(-FALL * u);
    }
    for (let k = 0; k < early; k++) {
      const i = start + Math.floor(R(name, 'early', 3 * k + c) * 0.06 * rate);
      const sign = R(name, 'early', 3 * k + 2) < 0.5 ? -1 : 1;
      if (i < n) data[i] += sign * 0.3 * (1 - k / (early + 1));
    }
  });
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

/**
 * The frequency of MIDI note `note` in hertz, with A4 (note 69) at `a4` hertz
 * (default 440): 60 is middle C, 12 notes make an octave, and a fractional
 * note is cents (0.01 of a note). A scale held in a piece's state as degrees
 * over a root note number turns into a voice's `pitch` here.
 */
function hertz(note, a4 = 440) {
  need('hertz', 'note', note, () => true, 'a finite MIDI note number');
  need('hertz', 'a4', a4, (v) => v > 0, 'a frequency in hertz above 0');
  return a4 * 2 ** ((note - 69) / 12);
}

/**
 * A plucked string, or anything taut that rings when it is let go, started at
 * `at` seconds and rendered offline into a mono buffer: one period of seeded
 * noise circulates through a delay line whose every pass averages neighbouring
 * samples, so the highs die first and the pitch is the loop's length. Returns a
 * buffer source; sum it with voices through `sumInto`.
 *
 * `pitch` is in hertz, from 20 to an eighth of the sample rate; a fractional
 * all-pass tunes the loop exactly. The fundamental falls to -60 dB over `decay`
 * seconds (default 1, at most 30), its higher partials sooner, then the whole
 * fades out over 80 ms. Where the averaging alone would end a high note before
 * `decay`, the average leans towards the newer sample, so it takes less each pass
 * and the note still rings that long. `level` (default 1) is the peak of the
 * noise that starts it. The noise is `R(name, 'pluck', index)`, its mean removed.
 *
 * A Web Audio feedback loop must hold a delay of at least one 128-sample block,
 * 375 Hz at 48 kHz at the highest, which is why this renders offline.
 */
function pluck(ctx, R, name, at, spec) {
  const who = `pluck ${name}`;
  group(who, 'spec', spec);
  const { pitch, decay = 1, level = 1 } = spec;
  const sr = ctx.sampleRate;
  need(who, 'at', at, (v) => v >= 0, 'a time in seconds, 0 or later');
  need(who, 'pitch', pitch, (v) => v >= 20 && v <= sr / 8, 'a frequency in hertz from 20 to an eighth of the sample rate');
  need(who, 'decay', decay, (v) => v > 0 && v <= 30, 'seconds above 0, at most 30');
  need(who, 'level', level, (v) => v >= 0, 'a linear level, 0 or more');
  const w = (2 * Math.PI * pitch) / sr;
  // The loss each period that brings the fundamental to -60 dB by `decay`.
  const loss = QUIET ** (1 / (pitch * decay));
  // Average (1 - s) of the newer sample with s of the older; s = 1/2 takes the
  // most, cos(w / 2) of the fundamental a pass, and a smaller s takes less.
  const q = (1 - loss * loss) / (2 * (1 - Math.cos(w)));
  const s = q < 0.25 ? (1 - Math.sqrt(1 - 4 * q)) / 2 : 0.5;
  const g = s < 0.5 ? 1 : loss / Math.cos(w / 2);
  // The loop's whole delay is one period: whole samples, the average's phase
  // delay, and an all-pass for what is left, between 0.5 and 1.5 samples.
  const rest = sr / pitch - Math.atan2(s * Math.sin(w), 1 - s + s * Math.cos(w)) / w;
  const N = Math.floor(rest - 0.5);
  const d = rest - N;
  const c = Math.sin((w * (1 - d)) / 2) / Math.sin((w * (1 + d)) / 2);
  const kick = Float64Array.from({ length: N }, (_, i) => 2 * R(name, 'pluck', i) - 1);
  const mean = kick.reduce((a, v) => a + v, 0) / N;
  const peak = kick.reduce((a, v) => Math.max(a, Math.abs(v - mean)), 0);
  const n = Math.ceil((decay + FADE) * sr);
  const y = new Float64Array(n);
  let u0 = 0, a0 = 0;
  for (let i = 0; i < n; i++) {
    const u = i >= N ? (1 - s) * y[i - N] + (i > N ? s * y[i - N - 1] : 0) : 0;
    const a = c * u + u0 - c * a0;
    [u0, a0] = [u, a];
    y[i] = (i < N && peak > 0 ? (level * (kick[i] - mean)) / peak : 0) + g * a;
  }
  const buf = ctx.createBuffer(1, n, sr);
  const data = buf.getChannelData(0);
  const fadeAt = decay * sr;
  for (let i = 0; i < n; i++) data[i] = y[i] * (i <= fadeAt ? 1 : 1 - (i - fadeAt) / (n - 1 - fadeAt));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.start(at);
  return src;
}

/**
 * How far music dips under the sounds something on screen causes, worked out
 * from the score: `[[seconds, gain], ...]` points in time order, linear gains
 * from 1 down, over the first `length` seconds. A film knows when every caused
 * sound starts before it renders, so nothing listens to the signal, and the dip
 * can start before the sound does.
 *
 * `events` are the caused sounds, each `{ at, length, level }`: `at` its start
 * in seconds, `length` how long it stays on top (default 0.1 s), `level` its
 * linear peak. An event asks for a dip as a compressor's side chain would: by
 * what its level passes `threshold` (default 0.05), in dB, less a `ratio`th of
 * it (default 2), and never more than `depth` dB (default 6). One with no
 * `level` asks for the whole `depth`; one at or under the threshold for none,
 * so a quiet detail does not pump the music.
 *
 * The dip follows what is asked in dB through a one-pole smoother with two
 * time constants, as a compressor's level detector does: it closes on a deeper
 * dip over `attack` seconds (default 0.03) and lets go over `release` (default
 * 0.35), 63% of the way in each. It starts `lead` seconds before each event
 * (default three attacks), so the music is already 95% down when the sound
 * lands. The points are `1 / rate` seconds apart (default 100 a second) and
 * left out wherever the gain rests.
 */
function ducking(events, opts = {}) {
  const who = 'ducking';
  if (!Array.isArray(events)) throw new RangeError(`${who}: events must be a list of { at, length, level }, got ${String(events)}`);
  group(who, 'opts', opts);
  const { length, depth = 6, threshold = 0.05, ratio = 2, attack = 0.03, release = 0.35, rate = 100 } = opts;
  const { lead = 3 * attack } = opts;
  need(who, 'length', length, (v) => v > 0, 'seconds above 0');
  need(who, 'depth', depth, (v) => v >= 0 && v <= 60, 'dB from 0 to 60');
  need(who, 'threshold', threshold, (v) => v > 0, 'a linear level above 0');
  need(who, 'ratio', ratio, (v) => v >= 1, '1 or more');
  need(who, 'attack', attack, (v) => v > 0, 'seconds above 0');
  need(who, 'release', release, (v) => v > 0, 'seconds above 0');
  need(who, 'lead', lead, (v) => v >= 0, 'seconds, 0 or more');
  need(who, 'rate', rate, (v) => v >= 10 && v <= 1000, 'points a second from 10 to 1000');
  const n = Math.ceil(length * rate - 1e-9) + 1;
  // What is asked at each point, in dB: the deepest dip of the events then on top.
  const asked = new Float64Array(n);
  events.forEach((e, i) => {
    group(who, `event ${i}`, e);
    const { at, length: on = 0.1, level } = e;
    need(who, `event ${i} at`, at, (v) => v >= 0, 'a time in seconds, 0 or later');
    need(who, `event ${i} length`, on, (v) => v >= 0, 'seconds, 0 or more');
    if (level !== undefined) need(who, `event ${i} level`, level, (v) => v >= 0, 'a linear level, 0 or more');
    const over = level === undefined ? Infinity : level > threshold ? 20 * Math.log10(level / threshold) * (1 - 1 / ratio) : 0;
    const dip = Math.min(depth, over);
    // At least the point nearest its start, so an event shorter than a step still asks.
    const from = Math.max(0, Math.min(Math.ceil((at - lead) * rate - 1e-9), Math.round(at * rate)));
    for (let k = from; k < n && k <= Math.max((at + on) * rate + 1e-9, Math.round(at * rate)); k++) asked[k] = Math.max(asked[k], dip);
  });
  const closes = Math.exp(-1 / (attack * rate)), opens = Math.exp(-1 / (release * rate));
  const gains = new Float64Array(n);
  let y = 0;
  for (let k = 0; k < n; k++) {
    const a = asked[k] > y ? closes : opens;
    y = a * y + (1 - a) * asked[k];
    // Under a thousandth of a dB the dip is over, so the music rests at 1.
    if (y < 1e-3 && asked[k] === 0) y = 0;
    gains[k] = 10 ** (-y / 20);
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    if (k === 0 || gains[k] !== gains[k - 1] || (k + 1 < n && gains[k] !== gains[k + 1])) out.push([k / rate, gains[k]]);
  }
  return out;
}

/**
 * A gain that dips as `ducking(events, opts)` says, on the context's clock:
 * sum the music into it with `sumInto` and sum it with the caused sounds, so
 * the music steps back under each of them and returns. It takes at most two
 * inputs, as every sum here does. The render is offline, so the page and the
 * film hold the same dip.
 */
function duck(ctx, events, opts) {
  const g = ctx.createGain();
  ducking(events, opts).forEach(([t, v], i) => g.gain[i ? 'linearRampToValueAtTime' : 'setValueAtTime'](v, t));
  return g;
}

// A bank of two-pole resonators run over `x` in place of it: each `[hertz,
// seconds to -60 dB, gain]` rings at its frequency and dies over its time.
function ringing(x, sr, modes) {
  const out = new Float64Array(x.length);
  for (const [hz, decay, gain] of modes) {
    const r = Math.exp(-FALL / (decay * sr));
    const a1 = 2 * r * Math.cos((2 * Math.PI * hz) / sr), a2 = -r * r;
    // Scaled so a single impulse rings at about `gain`.
    const g = gain * Math.sin((2 * Math.PI * hz) / sr);
    let y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const y = a1 * y1 + a2 * y2 + x[i];
      y2 = y1; y1 = y;
      out[i] += g * y;
    }
  }
  return out;
}

// A mono buffer source of `y` with its peak at `level`, faded out over its last 80 ms.
function rendered(ctx, y, at, level) {
  const sr = ctx.sampleRate, n = y.length, fadeN = Math.min(n, Math.ceil(FADE * sr));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(y[i]));
  const buf = ctx.createBuffer(1, n, sr);
  const data = buf.getChannelData(0);
  if (peak > 0) for (let i = 0; i < n; i++) data[i] = ((y[i] * level) / peak) * Math.min(1, (n - 1 - i) / fadeN);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.start(at);
  return src;
}

function modeList(who, name, list, nyquist) {
  if (!Array.isArray(list) || list.length === 0) throw new RangeError(`${who}: ${name} must be a list of [hertz, seconds, level] triples`);
  list.forEach((m, i) => {
    if (!Array.isArray(m)) throw new RangeError(`${who}: ${name} must be a list of [hertz, seconds, level] triples`);
    need(who, `${name} ${i} frequency`, m[0], (v) => v > 0 && v < nyquist, 'hertz under half the sample rate');
    need(who, `${name} ${i} decay`, m[1], (v) => v > 0 && v <= 30, 'seconds above 0, at most 30');
    need(who, `${name} ${i} level`, m[2] === undefined ? 1 : m[2], (v) => v >= 0, 'a linear level, 0 or more');
  });
  return list.map(([hz, decay, gain = 1]) => [hz, decay, gain]);
}

/**
 * One hit on a thing that rings, started at `at` seconds and rendered offline
 * into a mono buffer: the sound of a contact, for any subject. Returns a buffer
 * source; sum it with voices through `sumInto`.
 *
 * What is hit is its `modes`, `[hertz, seconds, level]` triples: each rings at
 * its frequency and falls to -60 dB over its seconds, on its own, as the modes
 * of a real object do. A few close, short modes read as wood or a box; long,
 * high ones that are not whole multiples as glass or metal; one low short one
 * as a thud. How it is hit is `contact`, the seconds the two things touch
 * (default 0.002, from 0.0002 to 0.05): the push is one smooth pulse that
 * long, so a long, soft contact leaves the high modes almost unrung and a
 * short, hard one rings them all; a mode at 2, 3 or more times `1 / contact`
 * hertz sits in a gap of that pulse and barely rings. `velocity`, from 0 to 1 (default 1), is how
 * hard: a softer hit is quieter and touches longer, up to twice `contact` at
 * 0, so it is duller too. `rough`, from 0 to 1 (default 0.1), mixes seeded
 * noise into the pulse, as a surface that is not smooth does. The peak is
 * `level` times `velocity` (default level 1). The noise is `R(name, 'impact',
 * sample)`. A contact a simulation reports gives `at` from its frame and
 * `velocity` from its speed.
 */
function impact(ctx, R, name, at, spec) {
  const who = `impact ${name}`;
  group(who, 'spec', spec);
  const { modes, contact = 0.002, velocity = 1, rough = 0.1, level = 1 } = spec;
  const sr = ctx.sampleRate;
  need(who, 'at', at, (v) => v >= 0, 'a time in seconds, 0 or later');
  const list = modeList(who, 'modes', modes, sr / 2);
  need(who, 'contact', contact, (v) => v >= 0.0002 && v <= 0.05, 'seconds from 0.0002 to 0.05');
  need(who, 'velocity', velocity, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  need(who, 'rough', rough, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  need(who, 'level', level, (v) => v >= 0, 'a linear level, 0 or more');
  const touch = contact * (2 - velocity);
  const pushN = Math.max(2, Math.round(touch * sr));
  const n = pushN + Math.ceil((Math.max(...list.map((m) => m[1])) + FADE) * sr);
  const x = new Float64Array(n);
  for (let i = 0; i < pushN; i++) x[i] = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / pushN)) * (1 - rough + rough * (2 * R(name, 'impact', i) - 1));
  return rendered(ctx, ringing(x, sr, list), at, level * velocity);
}

/**
 * Many small things striking each other or a surface, started at `at` seconds
 * and lasting `length`, rendered offline into a mono buffer: rain on a roof,
 * gravel underfoot, grain poured, something shaken or crumpled, for any
 * subject. Returns a buffer source; sum it with voices through `sumInto`.
 *
 * Nothing is placed by hand. `rate` collisions a second happen at seeded
 * moments; each adds the energy the things hold then to a burst of seeded
 * noise that dies over `ring` seconds (default 0.01), and the bursts pass
 * through what is struck, its `modes` as `impact` takes them (default one
 * broad mode at 3 kHz). `energy` is how hard the things move: a number, or
 * `[[seconds, energy], ...]` points from the start, linear between them and
 * held outside, as rain builds or a shake dies (default 1). `rate` takes such
 * points too. Few collisions with a long ring are heard one by one; many with
 * a short ring fuse into a texture. The loudest moment peaks at `level`
 * (default 1), and the end fades out over 80 ms. The collisions are
 * `R(name, 'hit', sample)` and the noise `R(name, 'grit', sample)`.
 */
function shaker(ctx, R, name, at, spec) {
  const who = `shaker ${name}`;
  group(who, 'spec', spec);
  const { length, rate, ring = 0.01, energy = 1, modes = [[3000, 0.004, 1]], level = 1 } = spec;
  const sr = ctx.sampleRate;
  need(who, 'at', at, (v) => v >= 0, 'a time in seconds, 0 or later');
  need(who, 'length', length, (v) => v >= FADE && v <= 600, `seconds from ${FADE} to 600`);
  need(who, 'ring', ring, (v) => v > 0 && v <= 2, 'seconds above 0, at most 2');
  need(who, 'level', level, (v) => v >= 0, 'a linear level, 0 or more');
  const list = modeList(who, 'modes', modes, sr / 2);
  // A number, or points read linearly and held outside them.
  const curve = (what, v, top, said) => {
    if (!Array.isArray(v)) { need(who, what, v, (k) => k >= 0 && k <= top, said); return () => v; }
    points(who, what, v, (k) => k >= 0 && k <= top, said);
    return (t) => {
      const j = v.findIndex(([s]) => s > t);
      if (j === 0) return v[0][1];
      if (j < 0) return v[v.length - 1][1];
      const [[t0, v0], [t1, v1]] = [v[j - 1], v[j]];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    };
  };
  const often = curve('rate', rate, 20000, 'collisions a second from 0 to 20000');
  const moves = curve('energy', energy, 1, 'from 0 to 1');
  const n = Math.ceil(length * sr);
  const x = new Float64Array(n);
  const dies = Math.exp(-FALL / (ring * sr));
  let loud = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (R(name, 'hit', i) < often(t) / sr) loud += moves(t);
    x[i] = loud * (2 * R(name, 'grit', i) - 1);
    loud *= dies;
  }
  return rendered(ctx, ringing(x, sr, list), at, level);
}

/**
 * What a score will do, read from its notes with no audio rendered, so `draw`
 * can move on it. `notes` are `[{ part, name, at, spec }]`: the `name`, `at` and
 * `spec` each note hands to `voice`, with the same `R`, and the `part` it belongs
 * to. `opt` is `{ hz, frames, grid }`, `grid` from `bars` of `core/time.js` and
 * optional. Returns:
 *
 * - `beats`, `[{ bar, beat, seconds, frame }]`, every beat of the grid in the film.
 * - `onsets`, `[{ part, name, at, frame, velocity }]` in time order, `frame` the
 *   nearest whole frame, rounded as `bars` and `shots` round.
 * - `energy`, `{ [part]: Float64Array(frames) }`: each frame's loudest moment of
 *   the part's body partials, as `voice` schedules them, its notes added as power.
 *
 * It follows attack, hold, each partial's decay, level, velocity, distance and
 * `vary`. Noise layers, filters, `fm`, `detune` beating and the room are not in
 * the curve, and a looping film's tail does not wrap.
 */
function scoreCurves(R, notes, opt = {}) {
  const who = 'scoreCurves';
  const { hz, frames, grid } = opt;
  need(who, 'hz', hz, (v) => v > 0, 'a frame rate above 0');
  if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError(`${who}: frames must be a whole number, 1 or more, got ${frames}`);
  if (!Array.isArray(notes)) throw new TypeError(`${who}: notes must be a list of { part, name, at, spec }`);
  const power = {};
  const onsets = [];
  notes.forEach((note, n) => {
    const label = `${who} note ${n}`;
    group(label, 'note', note);
    const { part, name, at, spec } = note;
    if (typeof part !== 'string' || !part) throw new TypeError(`${label}: part must be a name, got ${JSON.stringify(part)}`);
    need(label, 'at', at, (v) => v >= 0, 'a time in seconds, 0 or later');
    group(label, 'spec', spec);
    const { partials = [[1, 1]], attack = 0.005, hold = 0, decay = 1, damp = 0.5, level = 1, velocity = 1, vary = 0, distance = 0 } = spec;
    need(label, 'attack', attack, (v) => v > 0, 'seconds above 0');
    need(label, 'hold', hold, (v) => v >= 0, 'seconds, 0 or more');
    need(label, 'decay', decay, (v) => v > 0, 'seconds above 0');
    need(label, 'damp', damp, (v) => v >= 0, '0 or more');
    need(label, 'level', level, (v) => v >= 0, 'a linear level, 0 or more');
    need(label, 'velocity', velocity, (v) => v >= 0 && v <= 1, 'from 0 to 1');
    need(label, 'vary', vary, (v) => v >= 0 && v <= 1, 'from 0 to 1');
    need(label, 'distance', distance, (v) => v >= 0 && v <= 1, 'from 0 to 1');
    if (!Array.isArray(partials) || partials.length === 0) throw new RangeError(`${label}: partials must be a list of [ratio, level] pairs`);
    const curve = power[part] || (power[part] = new Float64Array(frames));
    onsets.push({ part, name, at, frame: Math.round(at * hz), velocity });
    // The same deviations `voice` draws, from the same addresses.
    const off = (k) => vary * (R(name, 'vary', k) * 2 - 1);
    const strength = level * velocity * 10 ** (0.15 * off(1) - 0.75 * distance);
    const fall = decay * (1 + 0.2 * off(2));
    const top = at + attack + hold;
    const bodies = partials.map(([ratio, amount], i) => ({
      peak: strength * amount * 10 ** (0.1 * off(3 + i)) * velocity ** (Math.max(0, ratio - 1) / 2),
      gone: top + fall / ratio ** damp,
    })).filter((b) => b.peak > 0);
    if (!bodies.length) return;
    const end = Math.max(...bodies.map((b) => b.gone)) + FADE;
    const last = Math.min(frames - 1, Math.ceil(end * hz));
    for (let f = Math.floor(at * hz); f <= last; f++) {
      // Every partial rises to `top` and falls after it, so a frame's loudest
      // moment is `top` when the frame holds it, or else its edge nearer `top`.
      const t = Math.min(Math.max(top, f / hz), (f + 1) / hz);
      for (const { peak, gone } of bodies) {
        const shape = t <= at ? 0
          : t < at + attack ? (t - at) / attack
            : t <= top ? 1
              : t < gone ? QUIET ** ((t - top) / (gone - top))
                : t < gone + FADE ? QUIET * (1 - (t - gone) / FADE) : 0;
        curve[f] += (peak * shape) ** 2;
      }
    }
  });
  const energy = {};
  for (const [part, curve] of Object.entries(power)) energy[part] = curve.map(Math.sqrt);
  onsets.sort((a, b) => a.at - b.at);
  const beats = [];
  if (grid) {
    for (let n = 0; Math.round(grid.seconds(0, n) * hz) < frames; n++) {
      beats.push({ bar: Math.floor(n / grid.beats), beat: n % grid.beats, seconds: grid.seconds(0, n), frame: Math.round(grid.seconds(0, n) * hz) });
    }
  }
  return { beats, onsets, energy };
}

module.exports = { sumInto, voice, ambience, room, pluck, hertz, ducking, duck, impact, shaker, scoreCurves };
