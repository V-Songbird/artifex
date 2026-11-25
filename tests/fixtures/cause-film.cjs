// A film built on the film scaffold whose soundtrack uses the three sound
// cues no other film exports: an ambience whose grains follow a rate curve,
// building from a few events a second to many and thinning again; a swell
// that leads its cause, rising before a disc enters; and a voice whose cause
// is never shown, placed off the right edge; all over a low bed of partials.
// The picture draws falls of short
// strokes at the grains' rate, the disc, and a glow on the right edge as the
// unseen cause sounds. For exporting and replaying those cues through AAC.

'use strict';

const { rng } = require('../../core/rand.js');
const { span, ease, shots } = require('../../core/time.js');
const { layer } = require('../../core/layer.js');
const { sumInto, voice, ambience, room } = require('../../core/sound.js');

const W = 640;
const H = 360;
const HZ = 24;

const SHOTS = [['field', 8]];
const DUR = SHOTS.reduce((sum, [, seconds]) => sum + seconds, 0);

// Events a second over the film, for the grains and the strokes alike.
const RATE = [[0, 8], [3, 120], [5, 120], [7.5, 15]];
// How long one stroke takes to cross the frame, in seconds.
const FALL = 0.5;

const ELEMENTS = [
  { name: 'field', enter: 0, exit: DUR },
  { name: 'glow', enter: 1.5, exit: 2.75 },
  { name: 'disc', enter: 4, exit: DUR },
];

// The grains peak at a sixth of the level of a low bed of partials under them:
// as the loudest sound, at 0.05 and no bed, a block of them decoded 17.5 dB
// from the render as AAC, under replay's 25 dB floor.
const SOUNDS = [
  { at: 0, cause: 'field', voice: { pitch: 110, partials: [[1, 1], [1.5, 0.3], [2, 0.2]], attack: 1.5, hold: 5, decay: 1.5, level: 0.12 } },
  { at: 0, cause: 'field', ambience: { length: DUR, colour: 1400, band: 1.5, level: 0.004, drift: 0.3, grains: { rate: RATE, length: 0.03, level: 0.02, spread: 10 } } },
  { at: 1.5, cause: 'caller', offscreen: { side: 'right', distance: 0.6 }, voice: { pitch: 150, partials: [[1, 1], [2.01, 0.4], [3.02, 0.15]], attack: 0.01, decay: 1.2, level: 0.35 } },
  { at: 3.4, cause: 'disc', lead: 0.6, voice: { pitch: 220, partials: [[1, 1], [2, 0.3]], attack: 0.6, hold: 1.5, decay: 2, level: 0.25, vibrato: { depth: 8, delay: 1 } } },
];

const ROOM = { size: 1.6 };
const SEND = 0.25;

const PAINT = {
  // Strokes falling across the frame, each from its own seeded column.
  field(g, s, e, life, clock) {
    const now = clock.seconds;
    g.strokeStyle = 'rgba(206, 214, 226, 0.7)';
    g.lineWidth = 2;
    g.beginPath();
    s.drops.forEach(([at, x], i) => {
      const u = (now - at) / FALL;
      if (u < 0 || u >= 1) return;
      const y = -30 + u * (H + 60) + 12 * Math.sin(i);
      g.moveTo(x - 4, y - 18);
      g.lineTo(x, y);
    });
    g.stroke();
  },
  // The right edge brightening as the unseen cause sounds, then settling.
  glow(g, s, e, life) {
    const a = 0.35 * Math.sin(Math.PI * ease.out(life.u));
    const grad = g.createLinearGradient(W, 0, W - 160, 0);
    grad.addColorStop(0, `rgba(222, 196, 150, ${a})`);
    grad.addColorStop(1, 'rgba(222, 196, 150, 0)');
    g.fillStyle = grad;
    g.fillRect(W - 160, 0, 160, H);
  },
  // A disc that grows in and keeps breathing to the last frame.
  disc(g, s, e, life) {
    const r = 46 * ease.out(Math.min(1, life.since / 1.2)) * (1 + 0.06 * Math.sin(2.4 * life.since));
    g.fillStyle = '#e3c483';
    g.beginPath();
    g.arc(W * 0.38, H * 0.52, r, 0, 2 * Math.PI);
    g.fill();
  },
};

module.exports = {
  name: 'cause-film',
  size: { w: W, h: H },
  outputs: ['raster'],
  time: { duration: DUR, hz: HZ },
  seed: 1,
  params: {},
  finish: null,

  state: () => ({ cues: null, drops: null }),

  build: [
    ['write the cues', (s) => {
      const film = shots(SHOTS, { hz: HZ, frames: Math.round(DUR * HZ) });
      const last = film[film.length - 1].end;
      const frame = (seconds) => Math.round(seconds * HZ);
      const elements = ELEMENTS.map((e) => ({ ...e, enter: frame(e.enter), exit: frame(e.exit) }));
      const alive = (name, from, to) => elements.some((e) => e.name === name && e.enter <= to && from < e.exit)
        || film.some((shot) => shot.name === name && shot.start <= to && from < shot.end);
      const seen = new Map();
      const sounds = SOUNDS.map((c) => {
        const f = frame(c.at);
        const { lead = 0, trail = 0, offscreen } = c;
        let voice = c.voice;
        if (offscreen) {
          if (c.lead !== undefined || c.trail !== undefined || !['left', 'right'].includes(offscreen.side) || !(offscreen.distance >= 0 && offscreen.distance <= 1)) {
            throw new Error(`the sound at ${c.at} s must have an off-screen side of 'left' or 'right' and a distance from 0 to 1, and no lead or trail`);
          }
          if (alive(c.cause, f, f)) throw new Error(`the sound at ${c.at} s declares its cause off screen, but ${c.cause} is on screen then`);
          voice = { ...c.voice, pan: offscreen.side === 'left' ? -1 : 1, distance: offscreen.distance };
        } else if (!alive(c.cause, f - (trail > 0 ? frame(trail) + 1 : 0), f + frame(lead))) {
          throw new Error(c.cause == null
            ? `the sound at ${c.at} s has no cause key: add cause: 'name' of the element on screen that makes it, or offscreen: { side, distance } for one never shown`
            : `the sound at ${c.at} s has no cause on screen: ${c.cause}`);
        }
        if (c.ambience && c.ambience.length * HZ > last - f + 1e-6) throw new Error(`the ambience at ${c.at} s lasts past the film's end at ${last / HZ} s`);
        const key = `${c.cause} ${f}`;
        seen.set(key, (seen.get(key) || 0) + 1);
        return { ...c, voice, frame: f, name: `${key} ${seen.get(key)}` };
      });
      s.cues = { shots: film, elements, sounds };
    }],
    ['drop the strokes', (s) => {
      // Stroke times where the rate curve is dense: one per event, at the
      // seconds its running count reaches, each jittered within its share.
      const R = rng(s.seed);
      const step = 1 / 1000;
      const rate = (t) => {
        const k = RATE.findIndex(([at]) => at > t);
        if (k === 0) return RATE[0][1];
        if (k < 0) return RATE[RATE.length - 1][1];
        const [[a, ra], [b, rb]] = [RATE[k - 1], RATE[k]];
        return ra + ((rb - ra) * (t - a)) / (b - a);
      };
      const drops = [];
      let count = 0;
      for (let i = 0; i < DUR / step; i++) {
        const t = i * step;
        const next = count + rate(t) * step;
        for (let k = Math.ceil(count); k < next; k++) drops.push([t + step * R('drop', 'time', k), 20 + (W - 40) * R('drop', 'x', k)]);
        count = next;
      }
      s.drops = drops;
    }],
  ],

  draw(g, s, _t, clock) {
    layer(g, s, 'ground', [0, 0, W, H], (lg) => {
      const grad = lg.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#1d2430');
      grad.addColorStop(1, '#2c3441');
      lg.fillStyle = grad;
      lg.fillRect(0, 0, W, H);
    });
    const f = clock.frame;
    for (const e of s.cues.elements) {
      if (f < e.enter || f >= e.exit) continue;
      PAINT[e.name](g, s, e, { u: span(e.enter, e.exit - 1, f), since: (f - e.enter) / HZ }, clock);
    }
  },

  sound(ctx, s, timeline) {
    const R = rng(s.seed);
    const dry = ctx.createGain();
    const hall = room(ctx, R, 'room', ROOM);
    const out = ctx.createGain();
    out.gain.setValueAtTime(1, Math.max(0, timeline.duration - 0.08));
    out.gain.linearRampToValueAtTime(0, timeline.duration);
    sumInto(ctx, [dry, hall], out);
    out.connect(ctx.destination);
    const voices = [];
    const sends = [];
    for (const c of s.cues.sounds) {
      const at = c.frame / timeline.hz;
      const v = c.ambience ? ambience(ctx, R, c.name, at, c.ambience) : voice(ctx, R, c.name, at, c.voice);
      const send = ctx.createGain();
      send.gain.value = c.ambience ? 0 : SEND + (1 - SEND) * (c.voice.distance || 0);
      v.connect(send);
      voices.push(v);
      sends.push(send);
    }
    sumInto(ctx, voices, dry);
    sumInto(ctx, sends, hall);
  },
};
