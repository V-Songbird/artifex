// drift -- organic and painterly. A timeline, and RASTER ONLY.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. It needs opacity,
// overlap and thousands of soft marks, none of which survive a plotter, so it
// declares `outputs: ['raster']` and means it. A set in which every example
// could go to vector would be quietly claiming that every piece can, and the one
// thing this library must never do is claim an output it cannot reach.
//
// It carries two pieces of art direction that no check catches:
//
//   1. THE LINE ARRIVES. Each stroke is a pen travelling along its own path, and
//      what grows is the arc length. `globalAlpha = progress` is a finished line
//      fading in, and it looks like one -- that difference is most of what makes
//      a drawing read as drawn.
//
//   2. FIVE CAUSES, KEPT APART. Morphological (where the form goes), gestural
//      (how it appears to have been made), material (how the medium behaves),
//      compositional (where things sit) and temporal (when things happen) each
//      draw from their own address. One noise family serving all five is what
//      produces recognisable algorithmic self-similarity, and it is the most
//      common reason generative work looks generated.

'use strict';

const { rng, fbm, noise2 } = require('../core/rand.js');
const { clamp01, lerp, pick } = require('../core/num.js');
const { streamline } = require('../core/field.js');

const W = 1000;
const H = 700;
// Three grounds, stated as art direction rather than as machinery: warm,
// neutral and cool paper. N2 -- a default whose reason names a subject is a
// preset, so these are a preset the piece opts into.
const GROUNDS = ['hsl(42 28% 93%)', 'hsl(0 0% 94%)', 'hsl(210 22% 94%)'];

module.exports = {
  name: 'drift',
  size: { w: W, h: H },
  outputs: ['raster'],
  time: { duration: 8, hz: 30 },
  seed: 77,
  params: {
    strokes: { min: 20, max: 260, value: 130,
      meaning: 'how many strokes the piece lays down' },
    reach: { min: 80, max: 560, value: 330,
      meaning: 'how far a stroke travels, in design units' },
    turn: { min: 0.02, max: 0.5, value: 0.11,
      meaning: 'how fast a stroke turns TOWARDS the field it crosses -- 0 is a straight line' },
  },

  state: () => ({ strokes: [], hue: 0 }),

  build: [
    ['choose the light', (s) => {
      const R = rng(s.seed);
      s.hue = Math.floor(R('light', 'hue') * 360);
      s.ground = pick(GROUNDS, R('light', 'ground'));
      s.split = 24 + R('light', 'split') * 130;     // how far the second hue sits
      s.focus = [0.3 + R('light', 'fx') * 0.4, 0.3 + R('light', 'fy') * 0.4];
    }],

    ['place the strokes', (s) => {
      const R = rng(s.seed);
      const n = Math.round(s.params.strokes);
      // A JITTERED GRID, NOT A CLOUD AROUND THE FOCUS. Scattering starts around
      // a single point and letting them all follow one field produces a bouquet:
      // every stroke leaves the same place and sweeps the same way. It looked
      // exactly like a plant, on a piece that must not look like anything. The
      // focus now modulates SIZE and DENSITY, which is what "detail falls away
      // from the focal relationship" actually asks for -- not position, which
      // just makes a clump.
      const cols = Math.max(2, Math.round(Math.sqrt(n * (W / H))));
      const rows = Math.max(2, Math.ceil(n / cols));
      s.strokes = [];
      for (let i = 0; i < n; i++) {
        const gx = (i % cols + 0.5) / cols;
        const gy = (Math.floor(i / cols) + 0.5) / rows;
        const x0 = (gx + (R('place', 'jx', i) - 0.5) * 1.5 / cols) * W;
        const y0 = (gy + (R('place', 'jy', i) - 0.5) * 1.5 / rows) * H;
        const near = 1 - Math.min(1, Math.hypot(x0 / W - s.focus[0], y0 / H - s.focus[1]) * 1.7);

        // COMPOSITIONAL: a stroke far from the focus is thinner, shorter and
        // quieter. Drop some of them entirely, so the field is not uniform.
        if (R('place', 'keep', i) > 0.35 + near * 0.75) continue;

        s.strokes.push({
          i,
          x0,
          y0,
          near,
          // TEMPORAL: when it happens. The big strokes land first, so the
          // composition is established before the detail arrives on top of it.
          birth: Math.pow(R('time', 'birth', i), 1.35) * 0.72,
          span: 0.14 + R('time', 'span', i) * 0.2,
          // GESTURAL: how it appears to have been made. One number per stroke
          // for pressure and one for speed, held for the whole stroke, because a
          // hand does not re-decide its grip every millimetre. A long tail, so a
          // few marks are emphatically broader than the rest rather than all of
          // them receiving the same attention.
          press: (0.2 + Math.pow(R('hand', 'pressure', i), 2.2) * 1.6) * (0.45 + near * 0.8),
          pace: 0.55 + R('hand', 'pace', i) * 0.9,
          // The stroke reads its OWN slice of the field, so a hundred strokes do
          // not collapse onto one attractor while still sharing a weather.
          lane: R('hand', 'lane', i) * 3.5,
          reach: 0.5 + Math.pow(R('hand', 'reach', i), 1.6) * 1.1,
        });
      }
    }],

    ['walk them through the field', (s) => {
      const R = rng(s.seed);
      const turn = s.params.turn;
      const reach = s.params.reach;
      for (const st of s.strokes) {
        // MORPHOLOGICAL: the form itself. One field, read by every stroke, which
        // is what makes them look like one weather rather than many accidents.
        const direction = (x, y) => fbm(R, x / 430 + st.lane, y / 430, 3, 'flow') * Math.PI * 4;
        const steps = Math.round(46 + st.pace * 64);
        const step = (reach * st.reach / steps) * (0.7 + st.pace * 0.6);
        // Turn TOWARDS the field with inertia; adding the field to the heading
        // each step would make nearly constant regions draw circular arcs.
        st.pts = streamline(direction, [st.x0, st.y0], {
          steps, step, turn, bounds: [-80, -80, W + 80, H + 80],
        });
      }
    }],
  ],

  draw(g, s, t) {
    const R = rng(s.seed);

    g.fillStyle = s.ground;
    g.fillRect(0, 0, W, H);

    // A ground: broad, low-contrast, laid before anything else, so the strokes
    // sit IN something instead of on nothing.
    for (let i = 0; i < 90; i++) {
      const x = R('ground', 'x', i) * W;
      const y = R('ground', 'y', i) * H;
      const r = 90 + noise2(R, x / 260, y / 260, 'ground') * 210;
      g.globalAlpha = 0.03;
      g.fillStyle = `hsl(${(s.hue + 150 + noise2(R, x / 400, y / 400, 'tint') * 60) % 360} 14% 88%)`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    for (const st of s.strokes) {
      const progress = clamp01((t - st.birth) / st.span);
      if (progress <= 0) continue;

      const n = st.pts.length;
      // THE PEN TRAVELS. `head` is an arc-length position, not an opacity.
      const head = progress * (n - 1);
      const last = Math.floor(head);
      // Colour is a ZONE, read from its own field at the stroke's origin, so the
      // picture has warm and cool regions a viewer can read. Rolling a hue per
      // stroke gives confetti -- every mark independently coloured is the same
      // mistake as every mark equally detailed.
      const zone = noise2(R, st.x0 / 520, st.y0 / 520, 'zone');
      const hue = (s.hue + (zone > 0.52 ? s.split : 0) + (zone - 0.5) * 30 + 360) % 360;

      for (let k = 0; k <= last; k++) {
        const [x, y] = st.pts[k];
        const u = k / (n - 1);
        // The taper is the stroke's own shape: fat where the pen pressed, thin
        // at both ends. It is NOT a function of the playhead, so a dab looks the
        // same the moment it lands and for the rest of the piece.
        const taper = Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.7;

        // MATERIAL: how the medium behaves. Per dab, addressed by (stroke, dab),
        // so the texture belongs to the MARK. A global grain pass over the
        // finished frame would treat every surface as though one particulate
        // process had affected all of them equally.
        const grit = R('medium', `d${st.i}`, k);
        const r = lerp(1.2, 13.2, st.press / 1.2) * taper * (0.78 + grit * 0.44);
        if (r <= 0.05) continue;

        g.globalAlpha = 0.03 + st.press * 0.05 * (0.5 + grit * 0.9);
        g.fillStyle = `hsl(${(hue + grit * 16) | 0} ${(16 + st.press * 26 + zone * 14) | 0}% ${(26 + (1 - Math.min(1, st.press)) * 30 + grit * 10) | 0}%)`;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }

      // The tip: one darker dab at the head, so the eye can find the moving pen.
      // Five excellent marks beat fifty equivalent ones, and this is the one
      // mark in the stroke that is allowed to be emphatic.
      if (last < n - 1) {
        const [x, y] = st.pts[last];
        g.globalAlpha = 0.26;
        g.fillStyle = `hsl(${hue | 0} ${(26 + st.press * 22) | 0}% ${(15 + (1 - Math.min(1, st.press)) * 18) | 0}%)`;
        g.beginPath();
        g.arc(x, y, (1 + st.press * 3) * (0.5 + progress * 0.5), 0, Math.PI * 2);
        g.fill();
      }
    }

    g.globalAlpha = 1;
  },
};
