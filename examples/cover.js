// cover -- a magazine front cover. The type is SET, never placed.
//
// IN THE SET BECAUSE IT IS THE FIRST PIECE WHOSE COMPOSITION IS DECIDED BY ITS
// CONTENT. Every other example decides where its marks go from the seed and the
// geometry alone; here the words arrive first, a grid measures them, and the
// generated field is grown AROUND the result. Change a coverline and the block
// re-wraps, re-fits, re-anchors, the panel behind it resizes, and the field
// flattens over a different patch of the sheet. Nothing in `draw` knows a
// coordinate: it iterates structures the build solved.
//
// THE ARGUMENT FOR THAT ORDER. A cover is the one artefact where the picture is
// subordinate to the text, and a piece that positions its lines by hand is a
// screenshot of one set of words. The build stages run type -> field -> ink for
// that reason, and the ink stage is last because it MEASURES the ground it will
// sit on and picks the colour with more contrast, rather than asserting one.
//
// WHAT IT IS MADE OF. `fillText` is refused by a vector surface, so the type is
// the stroke font next door -- the second piece to reach it, which by N4 is the
// point at which it stops being a preset. The field is polylines and the tonal
// bands are rectangles, so the whole sheet plots.

'use strict';

const { rng, noise2, fbm } = require('../core/rand.js');
const font = require('../core/stroke-font.js');

const W = 840;
const H = 1120;
const MARGIN = 56;
const GUTTER = 16;

// The copy. It is DATA: nothing below reads its length, its word count or its
// line breaks, so replacing any of it is a legal edit rather than a re-layout.
const COPY = {
  masthead: 'ARTIFEX',
  dominant: 'THE MACHINE THAT DRAWS ITSELF, AND THEN ARGUES WITH THE RESULT',
  secondary: [
    'A FIELD REPORT FROM THE FAR EDGE OF THE GRID',
    'WHY EVERY MARK HAS TO BE SOLVED BEFORE IT IS DRAWN',
    'NINE SEEDS, ONE COMPOSITION: READING A SYSTEM INSTEAD OF A PICTURE',
    'PLOTTER INK AND THE SLOW RETURN OF THE LINE',
  ],
  issue: 'ISSUE 07 / SEPTEMBER 2026',
  price: '12.00 GBP',
};

const PAPER = '#f2efe6';
const INK = '#14141a';
// Four grounds, stated as a preset. The reason for any one of them is art
// direction, not machinery. N2.
const ACCENTS = ['#b8432a', '#20507e', '#2f6b4f', '#7a3f86'];

// The font ships no metrics table, so its descent is measured from the outlines:
// the deepest station of any glyph, in cap heights. Leading that used 1.0 would
// let a comma on one line touch the cap line of the next.
const DEEP = Math.max(...Object.keys(font.GLYPHS)
  .flatMap((c) => font.glyph(c).flatMap((run) => run.map((p) => p[1])))) / 7;

module.exports = {
  name: 'cover',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,            // A COVER HAS NO TIMELINE.
  seed: 11,
  params: {
    // The grid is a knob because a cover's whole rhythm is its column count,
    // and because a layout that only works at one measure is a layout that was
    // placed by hand with extra steps.
    columns: { min: 2, max: 6, value: 4,
      meaning: 'how many columns the grid measures the type into, and so the whole rhythm' },
    // Field amplitude. At 0 the image is a flat ruling; the type must still
    // read, which is the check this parameter exists to make cheap.
    relief: { min: 0, max: 1, value: 0.62,
      meaning: 'how far the ruled field swells behind the type -- 0 is a flat ruling' },
  },

  state: () => ({
    grid: null, blocks: [], rules: [], bands: [], runs: [], panels: [], keep: [],
    accent: ACCENTS[0], panelFill: INK, fieldInk: INK, overflow: [], legibility: 0,
  }),

  build: [
    ['measure the sheet into columns', (s) => {
      const R = rng(s.seed);
      s.accent = ACCENTS[Math.floor(R('sheet', 'accent') * ACCENTS.length)];
      const cols = Math.max(2, Math.round(s.params.columns));
      const measure = W - 2 * MARGIN;
      const colW = (measure - (cols - 1) * GUTTER) / cols;
      s.grid = {
        cols,
        colW,
        x0: MARGIN,
        x1: W - MARGIN,
        y0: MARGIN,
        y1: H - MARGIN,
        measure,
        span: (i, n) => ({ x: MARGIN + i * (colW + GUTTER), w: n * colW + (n - 1) * GUTTER }),
      };
    }],

    ['set the type, which is the whole of the layout', (s) => {
      const G = s.grid;
      const B = [];

      // Masthead: fitted to the full measure, so the word decides the size
      // rather than the size deciding whether the word fits.
      const mast = setStack([COPY.masthead], G.measure, H, {
        sizeMax: fitSize(COPY.masthead, G.measure, 168), sizeMin: 18, lead: 1.2,
      });
      B.push(place(mast, { x: G.x0, w: G.measure, top: G.y0 }, 'left', {
        role: 'masthead', weight: mast.size * 0.055, ground: 'field', feather: 26,
      }));

      const rule = B[0].y + B[0].h + mast.size * 0.14;

      // Issue line: two runs on one baseline, one flushed each way. The right
      // one is positioned from its own measured width, which is the only way a
      // longer price stays on the sheet.
      const meta = setStack([COPY.issue], G.measure, H, { sizeMax: 13, sizeMin: 9, lead: 1.3 });
      B.push(place(meta, { x: G.x0, w: G.measure, top: rule + 14 }, 'left', {
        role: 'issue', weight: 1.15, ground: 'field', feather: 16,
      }));
      const price = setStack([COPY.price], G.measure, H, { sizeMax: 13, sizeMin: 9, lead: 1.3 });
      B.push(place(price, { x: G.x0, w: G.measure, top: rule + 14 }, 'right', {
        role: 'price', weight: 1.15, ground: 'field', feather: 16,
      }));

      const top = B[1].y + B[1].h;
      s.rules = [{ y: rule, x0: G.x0, x1: G.x1, weight: 2.4, ink: 'ink' }];

      // Dominant coverline: the widest span the grid leaves after the coverline
      // column, anchored to the FOOT, so added words grow the block upward into
      // the picture instead of off the bottom of the sheet.
      const dSpan = G.span(0, Math.max(1, G.cols - 1));
      const dom = setStack([COPY.dominant], dSpan.w, H * 0.38, {
        sizeMax: 66, sizeMin: 20, lead: 1.18,
      });
      B.push(place(dom, { x: dSpan.x, w: dSpan.w, bottom: G.y1 }, 'left', {
        role: 'dominant', weight: dom.size * 0.062, ground: 'panel', feather: 0,
      }));

      // Secondary coverlines: one narrow column, each item its own paragraph,
      // the stack shrunk until all four fit the space between the issue line and
      // the dominant block. A fifth coverline costs size, not overflow.
      const sSpan = G.span(G.cols - 1, 1);
      const sTop = top + 54;
      const sec = setStack(COPY.secondary, sSpan.w, Math.max(80, B[3].y - 30 - sTop), {
        sizeMax: 18, sizeMin: 7.5, lead: 1.34, gap: 1.5,
      });
      B.push(place(sec, { x: sSpan.x, w: sSpan.w, top: sTop }, 'left', {
        role: 'secondary', weight: 1.35, ground: 'field', feather: 15,
      }));

      // A leader rule above each coverline, measured off the line it leads.
      for (const L of B[4].lines) {
        if (L.dy === firstOf(B[4].lines, L.para).dy) {
          s.rules.push({ y: L.y - sec.size * 0.52, x0: sSpan.x, x1: sSpan.x + sSpan.w * 0.42, weight: 1.6, ink: 'accent' });
        }
      }

      s.blocks = B;
      // The panel the dominant block is reversed out of: its own box plus a
      // padding, bled off two edges. It is a consequence of the text, not a slab.
      const d = B[3];
      const pad = d.size * 0.42;
      s.panels = [{
        x: -1, y: d.y - pad * 1.5, w: d.x + d.w + pad - -1, h: H + 1 - (d.y - pad * 1.5), fill: 'panel',
      }];
    }],

    ['grow the field around the type', (s) => {
      const R = rng(s.seed);
      const relief = s.params.relief;
      // Only blocks standing directly on the picture ask it for room; a block
      // with its own panel already has a ground.
      const keep = s.blocks.filter((b) => b.ground === 'field' && b.lines.length)
        .map((b) => ({ x: b.ink_x0 - b.feather * 0.35, y: b.y - b.feather * 0.35, w: b.ink_w + b.feather * 0.7, h: b.h + b.feather * 0.7, feather: b.feather }));
      s.keep = keep;

      // Six tonal bands: the picture's areas. Their edges come off the same
      // terrain the rules follow, so the bands and the line work are one image
      // and not two effects stacked.
      s.bands = [];
      for (let i = 0; i < 6; i++) {
        const v = (i + 0.5) / 6;
        const y = -6 + (H + 12) * (i / 6);
        const tone = fbm(R, 0.5, v * 2.9, 3, 'terrain');
        s.bands.push({ y, h: (H + 12) / 6 + 0.5, tone: tone * 0.5 + noise2(R, 3.7, v * 5.1, 'wash') * 0.18 });
      }

      // The line work. Five separate causes, each with its own address:
      // terrain (the form), tooth (the material), drift (the gesture), the
      // keep-clear map (composition) and the band ladder (tone).
      const rows = 108;
      const stations = 76;
      s.runs = [];
      for (let i = 0; i < rows; i++) {
        const v = (i + 0.5) / rows;
        const base = -14 + v * (H + 28);
        const bias = 1 - Math.abs(v - 0.42) * 0.9;
        const pts = [];
        for (let j = 0; j <= stations; j++) {
          const u = j / stations;
          const x = -14 + u * (W + 28);
          const form = fbm(R, u * 2.3, v * 2.9, 4, 'terrain') - 0.5;
          const tooth = noise2(R, u * 9.5, v * 31, 'tooth') - 0.5;
          // `drift` is deliberately the one field with a HIGH frequency across
          // v: it makes neighbouring rules bunch and open, and bunching is the
          // only thing that makes a set of rules read as tone rather than as
          // ruled paper. Its amplitude stays under the row pitch so rules never
          // cross -- a crossed contour reads as a fault, not as texture.
          const gest = noise2(R, u * 1.9, v * 7.5, 'drift') - 0.5;
          const dy = (form * 112 * bias + gest * 17 + tooth * 3.2) * relief;
          const q = quiet(keep, x, base + dy);
          pts.push([x, base + dy * (1 - q), q]);
        }
        // Split where the field goes quiet, so the two states are two strokes
        // and the transition is a change of weight rather than a gap.
        let run = [pts[0]];
        for (let j = 1; j <= stations; j++) {
          run.push(pts[j]);
          const flip = (pts[j][2] > 0.5) !== (pts[j - 1][2] > 0.5);
          if (flip || j === stations) {
            if (run.length >= 2) s.runs.push({ pts: run.map((p) => [p[0], p[1]]), quiet: run[1][2] > 0.5 || run[0][2] > 0.5, band: bandAt(s.bands, base) });
            run = [pts[j]];
          }
        }
      }
    }],

    ['choose each block\'s ink by measured contrast', (s) => {
      // Legibility is DECIDED here, from the ground the block actually landed
      // on. A cover that asserts its type is readable has asserted it for one
      // set of words.
      const panel = mix(INK, s.accent, 0.22);
      s.panelFill = panel;
      s.fieldInk = mix(INK, s.accent, 0.5);
      for (const b of s.blocks) {
        const grounds = b.ground === 'panel' ? [panel] : bandsUnder(s.bands, b.y, b.y + b.h).map((t) => mix(PAPER, s.fieldInk, 0.05 + t * 0.42));
        const worst = (c) => Math.min(...grounds.map((g) => contrast(c, g)));
        const dark = worst(INK);
        const light = worst(PAPER);
        b.ink = dark >= light ? INK : PAPER;
        b.contrast = Math.max(dark, light);
      }
      s.legibility = Math.min(...s.blocks.map((b) => b.contrast));
    }],

    ['audit the margins', (s) => {
      // The check the brief is actually about: nothing may be off the sheet, at
      // any column count, for any copy. It is recorded rather than clamped --
      // a line silently pulled back inside is a layout that lied.
      const G = s.grid;
      s.overflow = [];
      for (const b of s.blocks) {
        for (const L of b.lines) {
          const bottom = L.y + b.size * DEEP;
          if (L.x < G.x0 - 0.01 || L.x + L.w > G.x1 + 0.01 || L.y < G.y0 - 0.01 || bottom > G.y1 + 0.01) {
            s.overflow.push(`${b.role}: "${L.text}"`);
          }
        }
      }
    }],
  ],

  draw(g, s) {
    g.lineCap = 'round';
    g.lineJoin = 'round';

    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    for (const b of s.bands) {
      g.fillStyle = mix(PAPER, s.fieldInk, 0.05 + b.tone * 0.42);
      g.fillRect(0, b.y, W, b.h);
    }

    for (const r of s.runs) {
      g.strokeStyle = r.quiet ? mix(PAPER, s.fieldInk, 0.16) : mix(s.fieldInk, PAPER, 0.10 + r.band * 0.42);
      g.lineWidth = r.quiet ? 0.5 : 0.9 + r.band * 1.5;
      g.beginPath();
      g.moveTo(r.pts[0][0], r.pts[0][1]);
      for (let i = 1; i < r.pts.length; i++) g.lineTo(r.pts[i][0], r.pts[i][1]);
      g.stroke();
    }

    for (const p of s.panels) {
      g.fillStyle = s.panelFill;
      g.fillRect(p.x, p.y, p.w, p.h);
    }

    for (const r of s.rules) {
      g.strokeStyle = r.ink === 'accent' ? s.accent : INK;
      g.lineWidth = r.weight;
      g.beginPath();
      g.moveTo(r.x0, r.y);
      g.lineTo(r.x1, r.y);
      g.stroke();
    }

    // Every line already knows its size, its weight, its colour and its place.
    for (const b of s.blocks) {
      g.strokeStyle = b.ink;
      g.lineWidth = b.weight;
      for (const L of b.lines) font.text(g, L.text, L.x, L.y, b.size);
    }
  },
};

// ---------------------------------------------------------------------------
// Setting type. None of this is about magazines; it is what any piece that puts
// words on a sheet has to do before it can put one down.
// ---------------------------------------------------------------------------

/** The cap height at which `text` exactly fills `w`, capped. Metrics scale linearly. */
function fitSize(text, w, cap) {
  const at = font.width(text, 100);
  return at > 0 ? Math.min(cap, (w / at) * 100) : cap;
}

/** Greedy wrap. A word wider than the measure is BROKEN, never allowed off the page. */
function wrapAt(text, w, size) {
  const out = [];
  let line = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (font.width(word, size) > w) {
      let k = word.length - 1;
      while (k > 1 && font.width(`${word.slice(0, k)}-`, size) > w) k--;
      if (line) { out.push(line); line = ''; }
      out.push(`${word.slice(0, k)}-`);
      word = word.slice(k);
    }
    const next = line ? `${line} ${word}` : word;
    if (line && font.width(next, size) > w) { out.push(line); line = word; }
    else line = next;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Wrap a run of paragraphs into a measure, shrinking until the whole stack fits
 * the height it was given. Returns lines with offsets, not positions: where the
 * stack lands is `place`'s business, and a block that is bottom-anchored has to
 * know its own height before it can know its top.
 */
function setStack(texts, w, hMax, o) {
  const gap = o.gap || 0;
  // LEADING HAS A FLOOR AND THE FLOOR IS THE FONT'S DESCENT. A leading of 1.1
  // cap heights looks generous and is not: the comma reaches 1.186 below the
  // cap line, so it lands inside the next line's letters. Nothing in the font
  // says so -- it ships no metrics -- and the collision is invisible until a
  // line happens to contain a comma. Measured, then enforced here.
  const lead = Math.max(o.lead, DEEP + 0.08);
  let size = o.sizeMax;
  for (;;) {
    const lines = [];
    let y = 0;
    for (let p = 0; p < texts.length; p++) {
      if (p) y += gap * size;
      for (const t of wrapAt(texts[p], w, size)) {
        lines.push({ text: t, dy: y, para: p });
        y += lead * size;
      }
    }
    const height = lines.length ? lines[lines.length - 1].dy + size * DEEP : 0;
    if (height <= hMax || size <= o.sizeMin + 1e-9) return { size, lines, height };
    size = Math.max(o.sizeMin, size - 0.25);
  }
}

/** Land a set stack in a box and flush it. `top` or `bottom`; never both. */
function place(st, box, align, extra) {
  const top = box.top === undefined ? box.bottom - st.height : box.top;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const L of st.lines) {
    L.w = font.width(L.text, st.size);
    L.x = align === 'right' ? box.x + box.w - L.w
      : align === 'center' ? box.x + (box.w - L.w) / 2
        : box.x;
    L.y = top + L.dy;
    if (L.x < x0) x0 = L.x;
    if (L.x + L.w > x1) x1 = L.x + L.w;
  }
  return Object.assign({
    size: st.size, lines: st.lines, align,
    x: box.x, y: top, w: box.w, h: st.height,
    ink_x0: x0 === Infinity ? box.x : x0,
    ink_w: x1 === -Infinity ? 0 : x1 - x0,
  }, extra);
}

function firstOf(lines, para) {
  return lines.find((L) => L.para === para);
}

// ---------------------------------------------------------------------------
// Colour. Two colours have to be mixable and two have to be comparable before a
// piece can decide anything about its own legibility.
// ---------------------------------------------------------------------------

function rgb(h) {
  const v = String(h).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}

function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return `#${[0, 1, 2].map((i) => {
    const v = Math.max(0, Math.min(255, Math.round(A[i] + (B[i] - A[i]) * t)));
    return v.toString(16).padStart(2, '0');
  }).join('')}`;
}

/** Relative luminance. Display values are NOT linear light; the decode is the point. */
function luma(c) {
  const [r, g, b] = rgb(c).map((v) => {
    const u = v / 255;
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = luma(a);
  const y = luma(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---------------------------------------------------------------------------
// The keep-clear map: how much the picture has to get out of the way at a point.
// ---------------------------------------------------------------------------

function quiet(boxes, x, y) {
  let m = 0;
  for (const b of boxes) {
    const d = Math.max(Math.max(b.x - x, x - (b.x + b.w)), Math.max(b.y - y, y - (b.y + b.h)));
    const f = d <= 0 ? 1 : d >= b.feather ? 0 : 1 - d / b.feather;
    if (f > m) m = f;
  }
  return m * m * (3 - 2 * m);
}

function bandAt(bands, y) {
  for (const b of bands) if (y >= b.y && y < b.y + b.h) return b.tone;
  return bands.length ? bands[bands.length - 1].tone : 0;
}

function bandsUnder(bands, y0, y1) {
  const hit = bands.filter((b) => b.y < y1 && b.y + b.h > y0).map((b) => b.tone);
  return hit.length ? hit : [bandAt(bands, y0)];
}
