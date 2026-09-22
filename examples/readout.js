// readout -- data-driven and abstract. A timeline, vector-bound, no type, no
// organic curvature, no field.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Its structure does not
// come from the seed. The seed decides how the piece LOOKS; a fixed dataset
// decides what it SAYS, and no re-roll may change that. Every other example in
// this set would happily let the seed move everything, and a library that
// assumes the seed is the only input cannot make this picture.
//
// The dataset is the first 96 digits of pi -- chosen because anyone can check
// it, it belongs to nobody, and it is not a plausible subject for the library.
//
// The testable form: solve at two different seeds and the digits are identical
// while the presentation is not. That check can fail, which is the point.
//
// IT IS ALSO THE PIECE THAT SOUNDS. Each digit is heard on the frame that first
// shows it: the pitch comes from the digit, so the data decides the melody; the
// voice comes from the sheet, so the seed decides only how it is played. The
// same split, read a fourth way, and the same check can fail.

'use strict';

const { rng } = require('../core/rand.js');
const { clamp, pick } = require('../core/num.js');
const { mix } = require('../core/colour.js');
const { stroke } = require('../core/path.js');

const DIGITS = (
  '1415926535' + '8979323846' + '2643383279' + '5028841971' + '6939937510'
  + '5820974944' + '5923078164' + '0628620899' + '8628034825' + '342117'
);

const W = 960;
const H = 640;
const M = 64;
const COLS = 24;
const ROWS = 4;
const SLOTS = 9;

const PAPER = '#f6f4ef';
const INK = '#1c1c20';
const MUTE = '#c9c4b8';
const ACCENTS = ['#cc4125', '#2f6f9f', '#3f7d55', '#8c5bb0'];

const GRID_W = W - 2 * M;
const TAPE_H = 110;
const GRID_H = H - 2 * M - TAPE_H - 34;
const CELL_W = GRID_W / COLS;
const CELL_H = GRID_H / ROWS;

// A major pentatonic from A3, one degree per digit: any order of digits stays
// consonant, so what is heard is the order itself.
const DEGREES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const ROOT_NOTE = 57;
// One voice per accent. The accent is the seeded choice of the sheet, so the
// voice is presentation; it may change the timbre and never the pitch.
const VOICES = [
  { wave: 'triangle', decay: 0.34, octave: 0.35 },
  { wave: 'sine', decay: 0.5, octave: 0.2 },
  { wave: 'sine', decay: 0.28, octave: 0.6 },
  { wave: 'triangle', decay: 0.5, octave: 0.1 },
];
const hertz = (note) => 440 * 2 ** ((note - 69) / 12);

module.exports = {
  name: 'readout',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: { duration: 6, hz: 24 },
  seed: 31,
  params: {
    lead: { min: 0.5, max: 6, value: 2.2,
      meaning: 'how many cells ahead of the fill the scan line runs' },
  },

  state: () => ({ cells: [], accent: ACCENTS[0] }),

  build: [
    ['read the data', (s) => {
      // NOTHING SEEDED HAPPENS IN THIS STAGE. The separation is the example.
      s.cells = [];
      for (let k = 0; k < DIGITS.length; k++) {
        s.cells.push({
          k,
          digit: Number(DIGITS[k]),
          col: k % COLS,
          row: Math.floor(k / COLS),
        });
      }
    }],

    ['choose the presentation', (s) => {
      const R = rng(s.seed);
      s.accent = pick(ACCENTS, R('sheet', 'accent'));
      for (const c of s.cells) {
        // Material irregularity, addressed per cell: adding a digit at the end
        // cannot move the jitter of the ones before it.
        c.jx = (R('cell', 'jx', c.k) - 0.5) * 1.6;
        c.jy = (R('cell', 'jy', c.k) - 0.5) * 1.6;
        c.wide = R('cell', 'wide', c.k) < 0.22;
      }
    }],
  ],

  draw(g, s, t) {
    const lead = s.params.lead;
    const scan = t * (s.cells.length + lead);

    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    // --- the slot grid, always fully drawn ------------------------------
    // The empty slots are the measure. Without them a low digit and a missing
    // cell look the same, which is the difference between a reading and a blot.
    g.strokeStyle = MUTE;
    g.lineWidth = 0.6;
    for (const c of s.cells) {
      const [x, y] = cellOrigin(c);
      for (let i = 0; i < SLOTS; i++) {
        const sy = y + CELL_H - 7 - (i + 1) * slotPitch();
        g.beginPath();
        g.rect(x, sy, c.wide ? 26 : 19, slotPitch() - 2.2);
        g.stroke();
      }
    }

    // --- the filled slots, arriving one at a time -----------------------
    for (const c of s.cells) {
      const arrived = clamp(Math.floor((scan - c.k) * 2.4), 0, c.digit);
      if (arrived <= 0) continue;
      const [x, y] = cellOrigin(c);
      // The value carries the digit a third way, mixed in linear light.
      g.fillStyle = c.digit >= 7 ? s.accent : mix(MUTE, INK, 0.35 + c.digit / 9);
      for (let i = 0; i < arrived; i++) {
        const sy = y + CELL_H - 7 - (i + 1) * slotPitch();
        g.beginPath();
        g.rect(x, sy, c.wide ? 26 : 19, slotPitch() - 2.2);
        g.fill();
      }
    }

    // --- the same data read a second way, as a profile ------------------
    const ty = H - M;
    g.strokeStyle = MUTE;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(M, ty);
    g.lineTo(W - M, ty);
    g.stroke();

    const done = clamp(Math.floor(scan), 0, s.cells.length);
    if (done >= 2) {
      g.strokeStyle = INK;
      g.lineWidth = 1.6;
      g.lineJoin = 'round';
      stroke(g, s.cells.slice(0, done).map((c, k) => [
        M + (k / (s.cells.length - 1)) * GRID_W,
        ty - (c.digit / 9) * TAPE_H,
      ]));
    }

    // --- the scan -------------------------------------------------------
    // It is a position, not a fade. A line arrives; it does not resolve out of
    // nothing, and the reader can always point at where the piece has got to.
    if (scan > 0 && scan < s.cells.length + lead) {
      const col = Math.min(COLS - 1, Math.floor(scan) % COLS);
      const row = Math.min(ROWS - 1, Math.floor(Math.floor(scan) / COLS));
      const x = M + col * CELL_W;
      g.strokeStyle = s.accent;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 4, M);
      g.lineTo(x - 4, M + GRID_H);
      g.stroke();
      g.beginPath();
      g.moveTo(M, M + row * CELL_H - 4);
      g.lineTo(W - M, M + row * CELL_H - 4);
      g.stroke();
    }
  },

  // Heard, not only seen. A note starts on the first frame on which the scan
  // reaches the cell's first slot -- the frame that fills it, for any digit
  // above zero -- found with draw's own arithmetic rather than an estimate of
  // it, and scheduled at that frame's second on the audio clock.
  sound(ctx, s, timeline) {
    const out = ctx.createGain();
    out.gain.value = 0.8;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 4200;
    out.connect(air);
    air.connect(ctx.destination);
    const voice = VOICES[ACCENTS.indexOf(s.accent)];
    const den = timeline.loop ? timeline.frames : timeline.frames - 1;
    const scanAt = (i) => (i / den) * (s.cells.length + s.params.lead);
    const note = (at, pitch, decay, gain, pan, overtone) => {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(gain, at + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0005, at + decay);
      const place = ctx.createStereoPanner();
      place.pan.value = pan;
      env.connect(place);
      place.connect(out);
      for (const [mul, level] of [[1, 1], [2, overtone]]) {
        if (!level) continue;
        const osc = ctx.createOscillator();
        osc.type = voice.wave;
        osc.frequency.value = hertz(pitch) * mul;
        const mixer = ctx.createGain();
        mixer.gain.value = level;
        osc.connect(mixer);
        mixer.connect(env);
        osc.start(at);
        osc.stop(at + decay + 0.05);
      }
    };
    let frame = 0;
    for (const c of s.cells) {
      while (frame < timeline.frames && Math.floor((scanAt(frame) - c.k) * 2.4) < 1) frame++;
      if (frame >= timeline.frames) break;
      const at = frame / timeline.hz;
      // The scan wraps to a new row here, and the row is marked an octave down.
      if (c.col === 0) note(at, ROOT_NOTE - 12, 0.9, 0.22, 0, 0);
      // The digits the picture paints in the accent ring brighter, as they look.
      note(at, ROOT_NOTE + DEGREES[c.digit], voice.decay * (c.wide ? 1.6 : 1), 0.2,
        (c.col / (COLS - 1)) * 1.2 - 0.6, c.digit >= 7 ? voice.octave * 2 : voice.octave);
    }
  },
};

function slotPitch() { return (CELL_H - 14) / SLOTS; }

function cellOrigin(c) {
  return [M + c.col * CELL_W + c.jx, M + c.row * CELL_H + c.jy];
}

