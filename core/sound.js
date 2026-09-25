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
 * Every layer fades out over 80 ms from -60 dB and stops, so nothing clicks. The
 * noise and variation are `R(name, 'strike' | 'tail' | 'vary', index)`: give each
 * voice its own `name`.
 */
function voice(ctx, R, name, at, spec) {
  const {
    pitch, partials = [[1, 1]], detune = 0, attack = 0.005, hold = 0, decay = 1, damp = 0.5,
    strike = {}, tail = {}, level = 1, pan = 0, velocity = 1, vary = 0,
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

  // This voice's own deviation, each in [-vary, vary].
  const dev = (k) => vary * (2 * R(name, 'vary', k) - 1);
  const cents = 12 * dev(0);
  const loud = level * velocity * 10 ** (0.15 * dev(1));
  const fall = decay * (1 + 0.2 * dev(2));
  const layers = [];
  const top = at + attack + hold;
  for (const [i, [ratio, amount]] of partials.entries()) {
    need(who, 'a partial ratio', ratio, (v) => v > 0, 'above 0');
    need(who, 'a partial level', amount, (v) => v >= 0, 'a linear level, 0 or more');
    const gone = top + fall / ratio ** damp;
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

  const place = ctx.createStereoPanner();
  place.pan.value = pan;
  sumInto(ctx, layers, place);
  return place;
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

module.exports = { sumInto, voice, room };
