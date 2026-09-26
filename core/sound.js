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

function need(who, name, v, ok, what) {
  if (!(typeof v === 'number' && Number.isFinite(v) && ok(v))) throw new RangeError(`${who}: ${name} must be ${what}, got ${v}`);
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
 * - The **tail** is seeded noise through a wide band at `tail.colour` hertz
 *   (default `pitch`), swelling with the body and falling over `tail.length`
 *   seconds after its attack: the air a sound leaves. Off at `tail.level` 0.
 *
 * Levels are linear; `level` scales all three and `pan` places the voice.
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
 *
 * Every layer fades out over 80 ms from -60 dB and stops, so nothing clicks. The
 * noise and variation are `R(name, 'strike' | 'tail' | 'vary' | 'vibrato', index)`:
 * give each voice its own `name`.
 */
function voice(ctx, R, name, at, spec) {
  const {
    pitch, partials = [[1, 1]], detune = 0, attack = 0.005, hold = 0, decay = 1, damp = 0.5,
    strike = {}, tail = {}, level = 1, pan = 0, velocity = 1, vary = 0,
    bend, vibrato, sweep, distance = 0,
  } = spec;
  const who = `voice ${name}`;
  need(who, 'at', at, (v) => v >= 0, 'a time in seconds, 0 or later');
  need(who, 'pitch', pitch, (v) => v > 0, 'a frequency in hertz above 0');
  need(who, 'attack', attack, (v) => v > 0, 'seconds above 0');
  need(who, 'hold', hold, (v) => v >= 0, 'seconds, 0 or more');
  need(who, 'decay', decay, (v) => v > 0, 'seconds above 0');
  need(who, 'damp', damp, (v) => v >= 0, '0 or more');
  need(who, 'detune', detune, (v) => v >= 0, 'cents, 0 or more');
  need(who, 'level', level, (v) => v >= 0, 'a linear level, 0 or more');
  need(who, 'pan', pan, (v) => v >= -1 && v <= 1, 'from -1 to 1');
  need(who, 'velocity', velocity, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  need(who, 'vary', vary, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  if (!Array.isArray(partials) || partials.length === 0) throw new RangeError(`${who}: partials must be a list of [ratio, level] pairs`);
  need(who, 'distance', distance, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  const nyquist = ctx.sampleRate / 2;
  if (bend !== undefined) points(who, 'bend', bend, () => true, 'cents');
  if (sweep !== undefined) points(who, 'sweep', sweep, (v) => v > 0 && v < nyquist, 'a frequency in hertz under half the sample rate');

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
    const { depth, rate = 5, delay = 0, rise = 0.3 } = vibrato;
    need(who, 'vibrato.depth', depth, (v) => v >= 0 && v <= 1200, 'cents from 0 to 1200');
    need(who, 'vibrato.rate', rate, (v) => v > 0 && v <= 20, 'hertz above 0, at most 20');
    need(who, 'vibrato.delay', delay, (v) => v >= 0, 'seconds, 0 or more');
    need(who, 'vibrato.rise', rise, (v) => v > 0, 'seconds above 0');
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
    need(who, 'a partial ratio', ratio, (v) => v > 0, 'above 0');
    need(who, 'a partial level', amount, (v) => v >= 0, 'a linear level, 0 or more');
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
  }
  if (lfo) lfo.stop(end);

  const burst = (part, opts, rise, length, colour, q, touch) => {
    const amount = opts.level === undefined ? 0 : opts.level;
    need(who, `${part}.level`, amount, (v) => v >= 0, 'a linear level, 0 or more');
    if (amount === 0 || loud * touch === 0) return;
    need(who, `${part}.length`, length, (v) => v > 0, 'seconds above 0');
    need(who, `${part}.colour`, colour, (v) => v > 0 && v < ctx.sampleRate / 2, 'a frequency in hertz under half the sample rate');
    const rate = ctx.sampleRate;
    const n = Math.ceil((length + FADE) * rate);
    const buf = ctx.createBuffer(1, n, rate);
    const data = buf.getChannelData(0);
    const riseN = rise * rate;
    const fallN = length * rate;
    const fadeN = FADE * rate;
    for (let i = 0; i < n; i++) {
      // Rise linearly, fall to -60 dB by `length`, then fade to nothing.
      const up = riseN > 0 ? Math.min(1, i / riseN) : 1;
      const down = Math.exp((-FALL * i) / fallN);
      const out = i <= fallN ? 1 : Math.max(0, 1 - (i - fallN) / fadeN);
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
  burst('tail', tail, attack, tail.length === undefined ? 1.5 : tail.length,
    tail.colour === undefined ? pitch : tail.colour, 0.6, 1);

  // The voice's own filters, in order: its sweep, then the air it crosses.
  const place = ctx.createStereoPanner();
  place.pan.value = pan;
  const lowpass = (corner) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = corner;
    f.Q.value = Math.SQRT1_2;
    return f;
  };
  const chain = [];
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
 * side's bed level up to `drift` times 6 dB, smoothly, about `rate` times a
 * second (defaults 0.5 and 0.3), as wind, water and traffic do. `level` is the
 * bed's RMS at its colour, linear (default 0.05; 0 leaves it out). Each side is
 * its own noise, so the bed is wide rather than a point.
 *
 * `grains`, when given, adds `grains.rate` events a second at seeded times:
 * each a sine at a seeded pitch in the band, rising `grains.chirp` octaves
 * (default 0) as it falls to -60 dB over `grains.length` seconds (default
 * 0.02), as a closing bubble does, then fading out over 80 ms. Each peaks at
 * `grains.level`, less a seeded 0 to `grains.spread` dB (default 12), at a
 * seeded place across the two sides.
 *
 * Everything rises over `fade` seconds (default 1, at least 80 ms) from silence
 * and falls back to silence over the same, so it never starts or stops on a cut.
 * The noise is `R(name, 'bed left' | 'bed right', index)`, apart from a room's, each event
 * `R(name, 'grain', 4 * event + 0..3)`, and the wandering
 * `noise2(R, seconds * rate, row, name + ' drift')`.
 */
function ambience(ctx, R, name, at, spec) {
  const { length, colour = 800, band = 2, level = 0.05, drift = 0.5, rate = 0.3, fade = 1, grains } = spec;
  const who = `ambience ${name}`;
  const sr = ctx.sampleRate;
  need(who, 'at', at, (v) => v >= 0, 'a time in seconds, 0 or later');
  need(who, 'fade', fade, (v) => v >= FADE, `seconds, at least ${FADE}`);
  need(who, 'length', length, (v) => v >= 2 * fade, 'seconds, at least twice its fade');
  need(who, 'colour', colour, (v) => v > 0 && v < 0.45 * sr, 'a frequency in hertz under 0.45 of the sample rate');
  need(who, 'band', band, (v) => v > 0 && v <= 8, 'octaves above 0, at most 8');
  need(who, 'level', level, (v) => v >= 0, 'a linear level, 0 or more');
  need(who, 'drift', drift, (v) => v >= 0 && v <= 2, 'octaves from 0 to 2');
  need(who, 'rate', rate, (v) => v > 0 && v <= 10, 'hertz above 0, at most 10');

  const n = Math.ceil(length * sr);
  const buf = ctx.createBuffer(2, n, sr);
  // 1 / Q of each of two band-passes that together are `band` octaves wide.
  const k = (2 ** band - 1) / 2 ** (band / 2) / Math.sqrt(Math.SQRT2 - 1);
  const fadeN = fade * sr;
  const wander = (row, i) => 2 * noise2(R, (i / sr) * rate, row, `${name} drift`) - 1;
  const faded = (i) => (i >= fadeN && n - 1 - i >= fadeN ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.min(i / fadeN, (n - 1 - i) / fadeN)));
  if (level > 0) ['bed left', 'bed right'].forEach((side, c) => {
    const data = buf.getChannelData(c);
    // Two state-variable band-passes in a row (Zavalishin's), stable at any corner and
    // steep enough that the band, not the hiss around it, is heard; retuned every 32 samples.
    const st = [0, 0, 0, 0];
    let a1 = 0, a2 = 0, a3 = 0, keep = 0, gain = 0;
    let power = 0;
    for (let i = 0; i < n; i++) {
      if (i % 32 === 0) {
        const hz = Math.min(colour * 2 ** (drift * wander(0, i)), 0.45 * sr);
        const g = Math.tan((Math.PI * hz) / sr);
        a1 = 1 / (1 + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
        // Equal loudness across its wandering: a wider band in hertz holds more power.
        keep = Math.sqrt(colour / hz);
        gain = 10 ** (0.3 * drift * wander(1 + c, i));
      }
      let y = 2 * R(name, side, i) - 1;
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
    const { rate: many, length: ring = 0.02, chirp = 0, level: peak, spread = 12 } = grains;
    need(who, 'grains.rate', many, (v) => v > 0 && v <= 2000, 'events a second above 0, at most 2000');
    need(who, 'grains.length', ring, (v) => v > 0 && v <= 2 && Math.ceil(v * sr) + Math.ceil(FADE * sr) < n,
      `seconds above 0, at most 2, and at least ${FADE} s shorter than the ambience`);
    need(who, 'grains.chirp', chirp, (v) => v >= -4 && v <= 4, 'octaves from -4 to 4');
    need(who, 'grains.level', peak, (v) => v >= 0, 'a linear level, 0 or more');
    need(who, 'grains.spread', spread, (v) => v >= 0 && v <= 60, 'dB from 0 to 60');
    const ringN = Math.ceil(ring * sr);
    const lastN = ringN + Math.ceil(FADE * sr);
    const riseN = Math.ceil(0.001 * sr);
    const fall = Math.exp(-FALL / ringN);
    const step = 2 ** (chirp / ringN);
    const [left, right] = [buf.getChannelData(0), buf.getChannelData(1)];
    const count = Math.round(many * length);
    for (let e = 0; e < count; e++) {
      const G = (k) => R(name, 'grain', 4 * e + k);
      const start = Math.floor(G(0) * (n - lastN));
      // Its pitch sits in the band around the colour of the moment, and stays under the top once it has risen.
      const from = Math.min(colour * 2 ** (drift * wander(0, start) + band * (G(1) - 0.5)), (0.45 * sr) / 2 ** Math.max(0, chirp));
      const amp = peak * 10 ** ((-spread * G(2)) / 20);
      const [l, r] = [Math.cos((Math.PI / 2) * G(3)), Math.sin((Math.PI / 2) * G(3))];
      let hz = from, phase = 0, env = amp;
      for (let i = 0; i < lastN; i++) {
        const v = env * (i < riseN ? i / riseN : 1) * (i <= ringN ? 1 : 1 - (i - ringN) / (lastN - ringN)) * faded(start + i) * Math.sin(phase);
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
function room(ctx, R, name, { size = 1.6, predelay = 0.012, bright = 7000, dark = 900, early = 6 } = {}) {
  const who = `room ${name}`;
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

module.exports = { sumInto, voice, ambience, room };
