// FILM SCAFFOLD -- structure only, no subject and no look.
//
// Copy this file beside your piece, rename it and fill every slot: the shots,
// the elements and what paints them, the sounds, the ground and the finish. It
// holds the plumbing every film repeats -- shots cut on whole frames, one cue
// table that picture and sound both read, a ground drawn once, a room the
// sounds play in, voices summed two at a time -- and nothing that decides what
// the film is. The style guide you follow decides that. An empty slot draws
// and sounds nothing.
//
// THE BEAT SHEET. Write it here, in seconds, before the code: each shot's beats,
// the background action under it, and the physical event that carries each
// transition. Then turn it into the tables below.
//
// THE LOOKS TO LEAVE OUT. Name them here too.

'use strict';

const { rng } = require('artifex/core/rand.js');
const { span, shots } = require('artifex/core/time.js');
const { layer } = require('artifex/core/layer.js');
const { sumInto, voice, room } = require('artifex/core/sound.js');

const W = 1280;
const H = 720;
const HZ = 24;

// THE SHOTS, in seconds, in playing order: [name, seconds]. They fill the film.
const SHOTS = [['first', 4]];
const DUR = SHOTS.reduce((sum, [, seconds]) => sum + seconds, 0);

// THE CUE TABLE: every element on screen, when it enters and when it EXITS, in
// seconds from the film's start. A row without an exit is refused: an element
// leaves when its job ends. `exit: DUR` keeps one to the last frame on purpose.
// Add any fields your paint reads, such as where it goes or how it moves.
//   { name: 'a', enter: 0.5, exit: 3.2 },
const ELEMENTS = [];

// THE SOUNDS: each at the second its picture shows its cause, which is an
// element on screen then or the shot that holds it (for a bed). `voice` takes
// core/sound.js's voice spec: a transient, a body of partials and a tail, how
// hard it starts (`velocity`) and how much it differs from its neighbours
// (`vary`). `wet` is how much of it the room takes: a far sound is softer,
// darker and wetter than a near one.
//   { at: 0.5, cause: 'a', wet: 0.2, voice: { pitch: 330, partials: [[1, 1], [2.7, 0.3]], velocity: 0.8, vary: 0.4, strike: { level: 0.3 } } },
//   { at: 0, cause: 'first', voice: { pitch: 55, attack: 1.5, hold: 1, decay: 1.5, detune: 9, level: 0.2 } },
const SOUNDS = [];

// THE ROOM the sounds play in, and how much of a sound it takes by default.
const ROOM = { size: 1.6 };
const SEND = 0.25;

// WHAT PAINTS EACH ELEMENT, by name: paint(g, state, element, life, clock).
// `life.u` runs from 0 on its first frame to 1 on its last, `life.since` is
// seconds since it entered; time its moves from them with core/time.js.
const PAINT = {};

module.exports = {
  name: 'film-scaffold',
  size: { w: W, h: H },
  outputs: ['raster'],
  time: { duration: DUR, hz: HZ },
  seed: 1,
  params: {},
  // THE FILM FINISH: one process over every frame of the whole film, declared
  // once. null until you choose one; see Film finish in the skill.
  finish: null,

  state: () => ({ cues: null }),

  build: [
    ['write the cues', (s) => {
      // Every time lands on a whole frame here, once; draw and sound read only this.
      const film = shots(SHOTS, { hz: HZ, frames: Math.round(DUR * HZ) });
      const last = film[film.length - 1].end;
      const frame = (seconds) => Math.round(seconds * HZ);
      const elements = ELEMENTS.map((e) => {
        if (typeof e.exit !== 'number') throw new Error(`element ${e.name} has no exit`);
        const at = { ...e, enter: frame(e.enter), exit: frame(e.exit) };
        if (!(at.enter >= 0 && at.exit > at.enter && at.exit <= last)) {
          throw new Error(`element ${e.name} must enter at 0 or later and exit after it enters, by ${DUR} s`);
        }
        return at;
      });
      const alive = (name, f) => elements.some((e) => e.name === name && e.enter <= f && f < e.exit)
        || film.some((shot) => shot.name === name && shot.start <= f && f < shot.end);
      const seen = new Map();
      const sounds = SOUNDS.map((c) => {
        const f = frame(c.at);
        if (!alive(c.cause, f)) throw new Error(`the sound at ${c.at} s has no cause on screen: ${c.cause}`);
        // Named by cause and frame, so adding a sound never moves another's noise.
        const key = `${c.cause} ${f}`;
        seen.set(key, (seen.get(key) || 0) + 1);
        return { ...c, frame: f, name: `${key} ${seen.get(key)}` };
      });
      s.cues = { shots: film, elements, sounds };
    }],
  ],

  draw(g, s, _t, clock) {
    // THE GROUND: the part of every frame that never changes, drawn once.
    layer(g, s, 'ground', [0, 0, W, H], (lg) => {
      lg.fillStyle = '#808080';
      lg.fillRect(0, 0, W, H);
    });
    const f = clock.frame;
    for (const e of s.cues.elements) {
      if (f < e.enter || f >= e.exit || !PAINT[e.name]) continue;
      PAINT[e.name](g, s, e, { u: span(e.enter, e.exit - 1, f), since: (f - e.enter) / HZ }, clock);
    }
  },

  sound(ctx, s, timeline) {
    const R = rng(s.seed);
    const dry = ctx.createGain();
    const hall = room(ctx, R, 'room', ROOM);
    sumInto(ctx, [dry, hall], ctx.destination);
    const voices = [];
    const sends = [];
    for (const c of s.cues.sounds) {
      const v = voice(ctx, R, c.name, c.frame / timeline.hz, c.voice);
      const send = ctx.createGain();
      send.gain.value = c.wet === undefined ? SEND : c.wet;
      v.connect(send);
      voices.push(v);
      sends.push(send);
    }
    sumInto(ctx, voices, dry);
    sumInto(ctx, sends, hall);
  },
};
