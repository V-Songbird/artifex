#!/usr/bin/env node
'use strict';

// Break it on purpose, and check that the RIGHT test notices.
//
// Each mutation must fail its named regression test. Report coverage gaps
// separately from failures caught by an unintended test:
//
//   ESCAPED    nothing failed. The suite does not cover this.
//   MISNAMED   something failed, but not the test aimed at. Catching the right
//              break for the wrong reason is the same bug one level up.
//   INFRA     the process or TAP report is incomplete; no mutation verdict.
//   ok         the expected test failed.
//
// It mutates TEXT in a copy, never a tracked file, and refuses a patch that is
// absent or that matches more than once -- a mutation that lands in two places
// is not the experiment you wrote.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

const ROOT = path.join(__dirname, '..');

/** Each mutation names the file, a UNIQUE substring, its replacement, and the test it must trip. */
const MUTATIONS = [
  {
    why: 'pixel previews are accepted on pieces claiming vector output',
    file: 'core/piece.js',
    from: "  if (out.preview && out.outputs.includes('vector')) {",
    to: '  if (false) {',
    expect: 'pixel preview requires an explicit bounded descriptor and a CPU draw',
  },
  {
    why: 'GPU uniforms discard the resolved seed',
    file: 'core/webgpu-preview.js',
    from: '  uints.set([width, height, solved.seed, clock.frame]);',
    to: '  uints.set([width, height, 0, clock.frame]);',
    expect: 'GPU uniforms preserve resolved seeds and the shared quantized frame clock',
  },
  {
    why: 'an obsolete GPU frame is presented after a newer recipe was requested',
    file: 'core/webgpu-preview.js',
    from: '      if (disposed || ticket !== generation || !isCurrent()) return { stale: true };\n      const validated = now();',
    to: '      if (false) return { stale: true };\n      const validated = now();',
    expect: 'GPU preview discards stale initialization and stale queued frames',
  },
  {
    why: 'a GPU preview step past its deadline is never given up',
    file: 'core/webgpu-preview.js',
    from: "        timer = setTimeout(() => { expired = true; reject(new Error('GPU preview ' + label + ' timed out')); }, timeoutMs);",
    to: '',
    expect: 'GPU preview times out and destroys a device delivered after the deadline',
  },
  {
    why: 'the raster recorder ignores pixel bytes, so changed images have identical digests',
    file: 'tests/examples.test.js',
    from: '    hash.update(image.data);',
    to: '    hash.update(new Uint8Array(0));',
    expect: 'the recorder measures raster bytes and device-space image bounds',
  },
  {
    why: 'unknown top-level keys are accepted',
    file: 'core/piece.js',
    from: 'if (unknown.length) {',
    to: 'if (false) {',
    expect: 'an unknown key is refused and named',
  },
  {
    why: 'the build reports the stages it FINISHED instead of the ones it declared',
    file: 'core/piece.js',
    from: 'const out = { state, seed: sd, stages: { ms, of: piece.build.length, error } };',
    to: 'const out = { state, seed: sd, stages: { ms, of: ms.length, error } };',
    expect: 'solve reports every DECLARED stage, not only the ones that finished',
  },
  {
    why: 'a parameter may be declared without saying what it does, so a knob goes back to being three numbers',
    file: 'core/piece.js',
    from: '        if (typeof p.meaning !== \'string\' || !p.meaning.trim()) {',
    to: '        if (false) {',
    expect: 'a declared parameter must SAY WHAT IT DOES, and the saying is not optional',
  },
  {
    why: 'a misspelled key inside a params entry is accepted, which is how a wrong contract passed every check before',
    file: 'core/piece.js',
    from: '        if (extra.length) return `unknown key(s) in params.${k}: ${extra.join(\', \')}; known: ${KNOWN.join(\', \')}`;',
    to: '        if (false) return null;',
    expect: 'a params entry carries no keys beyond the four, and a misspelling is named',
  },
  {
    why: 'an unknown build stage is accepted, so a look at a stage that does not exist comes back as the finished state',
    file: 'core/piece.js',
    from: '  if (until !== null && !piece.build.some(([n]) => n === until)) {',
    to: '  if (false) {',
    expect: 'a build can be stopped at a named stage, and an unknown name is refused',
  },
  {
    why: 'the named stage does not stop the build, so every look returns the finished state',
    file: 'core/piece.js',
    from: '      if (name === until) break;',
    to: '      if (false) break;',
    expect: 'summarise reaches the shape of a real piece part-way through its build',
  },
  {
    why: 'a list of objects reports only how many, so a reader is told 4,812 things and not what they are',
    file: 'core/piece.js',
    from: '    if (!numeric && v.length) d.of = shape(v[0]);',
    to: '    if (false) d.of = shape(v[0]);',
    expect: 'summarise describes a build state instead of copying it',
  },
  {
    why: 'an object in the state is descended into instead of named, so the summary is the state again',
    file: 'core/piece.js',
    from: '  return { keys: Object.keys(v) };',
    to: '  return v;',
    expect: 'summarise describes a build state instead of copying it',
  },
  {
    why: 'the document drops the manifest it was drawn from, so a saved picture carries no recipe',
    file: 'core/surface-vector.js',
    from: '    const meta = this._manifest',
    to: '    const meta = (false)',
    expect: 'a render carries a manifest of how to make it again',
  },
  {
    why: 'the manifest lists only the parameters that were overridden, so the recipe stops working the day a default moves',
    file: 'core/piece.js',
    from: '    params: { ...solved.state.params },',
    to: '    params: {},',
    expect: 'a render carries a manifest of how to make it again',
  },
  {
    why: 'the manifest records the playhead that was ASKED for instead of the frame that was drawn',
    file: 'core/render.js',
    from: '  const manifest = { ...solved.manifest, t };',
    to: '  const manifest = { ...solved.manifest, t: opt.t === undefined ? 1 : opt.t };',
    expect: 'the manifest records the frame that was DRAWN, not the one that was asked for',
  },
  {
    why: 'a timeline becomes mandatory, so a still is no longer a legal piece',
    file: 'core/piece.js',
    from: '      if (v === null) return null;',
    to: '      if (v === null) return "a piece must have a timeline";',
    expect: 'A STILL IS A LEGAL PIECE, and a timeline is opt-in',
  },
  {
    why: 'the playhead is not quantised to the drawn-frame grid',
    file: 'core/piece.js',
    from: '  return frameIndex(piece, t) / frameDen(piece);',
    to: '  return Math.min(1, Math.max(0, t));',
    expect: 'a timeline quantises to the drawn-frame grid, and clamps outside [0,1]',
  },
  {
    why: 'stroke width ignores the transform',
    file: 'core/surface-vector.js',
    from: '`stroke-width="${n(st.lineWidth * k)}"`',
    to: '`stroke-width="${n(st.lineWidth)}"`',
    expect: 'stroke width scales by sqrt(|det|) of the transform',
  },
  {
    why: 'a non-finite coordinate is written to the file instead of throwing',
    file: 'core/surface-vector.js',
    from: "  if (!Number.isFinite(v)) throw new Error(`vector surface: non-finite coordinate ${v}`);",
    to: '  if (!Number.isFinite(v)) return String(v);',
    expect: 'a non-finite coordinate throws rather than reaching the file',
  },
  {
    why: 'the transform is dropped instead of baked into coordinates',
    file: 'core/surface-vector.js',
    from: '  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];',
    to: '  return [x, y];',
    expect: 'the transform is baked into coordinates',
  },
  {
    why: 'the affine-fallback Bezier constant is wrong, so a transformed ellipse loses radial accuracy',
    file: 'core/surface-vector.js',
    from: '    const alpha = (4 / 3) * Math.tan(step / 4);',
    to: '    const alpha = Math.tan(step / 4);',
    expect: 'an arc under a NON-UNIFORM scale becomes a real ellipse',
  },
  {
    why: 'a style string reaches the document unescaped',
    file: 'core/surface-vector.js',
    from: "  return String(s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));",
    to: '  return String(s);',
    expect: 'a colour or a stop is escaped, so a string cannot close an attribute',
  },
  {
    why: 'vector output is handed to a piece that never declared it',
    file: 'core/render.js',
    from: "  if (!p.outputs.includes('vector')) {",
    to: '  if (false) {',
    expect: 'vector output is REFUSED for a piece that did not declare it',
  },
  {
    why: 'a draw that throws leaves its transform on the surface',
    file: 'core/render.js',
    from: '    if (surface.restore) surface.restore();',
    to: '    if (false) surface.restore();',
    expect: 'drawFrame leaves the surface state as it found it, even if draw throws',
  },
  {
    why: 'a still is given more than one playhead',
    file: 'core/render.js',
    from: '  if (n === 1) return [0];',
    to: '  if (n === 1) return [0, 0];',
    expect: 'a still has exactly one playhead, and it is 0',
  },
  {
    why: 'render scale is capped at 2, putting print resolution out of reach',
    file: 'core/render.js',
    from: '  const scale = opt.scale === undefined ? 1 : opt.scale;',
    to: '  const scale = Math.min(2, opt.scale === undefined ? 1 : opt.scale);',
    expect: 'scale is not capped, so print resolution is reachable',
  },

  // --- the stochastic source ----------------------------------------------
  {
    why: 'the two halves of an address run together, so unrelated quantities share a value',
    file: 'core/rand.js',
    from: '      h = fnv1a(SEP + property, fnv1a(entity, base));',
    to: '      h = fnv1a(property, fnv1a(entity, base));',
    expect: 'the two halves of an address do not run together',
  },
  {
    why: 'the finaliser is dropped, so consecutive indices walk slowly',
    file: 'core/rand.js',
    from: '    return mix32(h ^ Math.imul(index | 0, 0x9e3779b1)) / 4294967296;',
    to: '    return ((h ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0) / 4294967296;',
    expect: 'near addresses do not give near values',
  },
  {
    why: 'noise2 ignores the field name, so every irregularity has one cause',
    file: 'core/rand.js',
    from: "function noise2(R, x, y, name = 'field') {",
    to: "function noise2(R, x, y, ignored = 'field') { const name = 'field';",
    expect: 'two named fields are independent at the same point',
  },
  {
    why: 'every fbm octave reads the same field, so the octaves buy nothing',
    file: 'core/rand.js',
    from: '    sum += amp * noise2(R, x * f, y * f, ns[o]);',
    to: '    sum += amp * noise2(R, x * f, y * f, name);',
    expect: 'fbm octaves are separate fields, not one field read at two scales',
  },

  // --- declared parameters --------------------------------------------------
  {
    why: 'a declared parameter never reaches the build, so it cannot move the output',
    file: 'core/piece.js',
    from: '    state.params[k] = v;',
    to: '    state.params[k] = d.value;',
    expect: 'EVERY DECLARED PARAMETER MOVES THE OUTPUT, at three pins and not two',
  },
  {
    why: 'a parameter outside its declared range is accepted',
    file: 'core/piece.js',
    from: '    if (!Number.isFinite(v) || v < d.min || v > d.max) {',
    to: '    if (false) {',
    expect: 'an undeclared parameter is refused by name',
  },

  // --- the examples, which are the real specification -----------------------
  {
    why: 'THE CROSSBAR: a two-point straight run is filtered out of a glyph',
    file: 'core/stroke-font.js',
    from: '    for (const run of glyph(ch)) {',
    to: '    for (const run of glyph(ch).filter((q) => q.length > 2)) {',
    expect: 'specimen: every run of every glyph survives being drawn',
  },
  {
    why: 'an unknown character quietly draws a different glyph',
    file: 'core/stroke-font.js',
    from: "  if (src === undefined || src === '') return [];",
    to: "  if (src === undefined || src === '') return glyph('X');",
    expect: 'specimen: an unknown character is a gap, never a substituted glyph',
  },
  {
    why: 'a line fades up instead of arriving, so every laid dab changes with the playhead',
    file: 'examples/drift.js',
    from: '        g.globalAlpha = 0.03 + st.press * 0.05 * (0.5 + grit * 0.9);',
    to: '        g.globalAlpha = progress * 0.08;',
    expect: 'drift: THE LINE ARRIVES -- a pen travels, it does not fade up',
  },
  {
    why: 'a late stroke runs past the end of the film, so the last frame shows it unfinished',
    file: 'examples/drift.js',
    from: '      const progress = span(st.birth, Math.min(st.birth + st.span, 1), t);',
    to: '      const progress = span(st.birth, st.birth + st.span, t);',
    expect: 'drift: every stroke is finished on the last frame',
  },
  {
    why: 'the taper reaches nothing before the path ends, so the tip runs ahead of the body',
    file: 'examples/drift.js',
    from: '        const taper = Math.sin(Math.PI * Math.min(1 - 1 / (n - 1), u * 1.05)) ** 0.7;',
    to: '        const taper = Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.7;',
    expect: "drift: a stroke's body reaches its tip on every frame",
  },
  {
    why: 'the subdivision is uniform, so every cell gets the same attention',
    file: 'examples/partition.js',
    from: 'const keep = d < maxDepth && w > 15 && h > 15 && (want * 0.95 + grain * 0.32) > 0.44;',
    to: 'const keep = d < maxDepth && w > 15 && h > 15 && (0.95 + grain * 0.32) > 0.44;',
    expect: 'partition: detail falls away from the focus rather than filling the sheet',
  },
  {
    why: 'contour segments are not chained, so a plotter lifts the pen thousands of times',
    file: 'examples/contours.js',
    from: '      const traced = lines.paths.map((pts) => pts.map(([gx, gy]) => [',
    to: '      const traced = lines.segments.map((pts) => pts.map(([gx, gy]) => [',
    expect: 'contours: chaining collapses the segments into few pen-down paths',
  },
  {
    why: 'the seed reaches the DATA, so a re-roll makes the piece say something else',
    file: 'examples/readout.js',
    from: '          digit: Number(DIGITS[k]),',
    to: '          digit: Number(DIGITS[(k + s.seed) % DIGITS.length]),',
    expect: 'readout: the DATA is not seeded, and the presentation is',
  },
  {
    why: 'past the last cell the scan line wraps to the start of the last row',
    file: 'examples/readout.js',
    from: '      const col = k % COLS;',
    to: '      const col = Math.floor(scan) % COLS;',
    expect: 'readout: the scan line never runs back at the end of the reading',
  },
  {
    why: 'a cued move starts a frame after the frame its cue declares',
    file: 'examples/cues.js',
    from: 'v[m.prop] = lerp(m.from, m.to, tween(m.a, m.b, ease[m.rate])(frame));',
    to: 'v[m.prop] = lerp(m.from, m.to, tween(m.a + 1, m.b, ease[m.rate])(frame));',
    expect: 'cues: every move starts and arrives on the frames its cue declares',
  },
  {
    why: 'a bump runs a frame past its window, so the blink peaks between frames',
    file: 'examples/cues.js',
    from: 'v[b.prop] += b.size * ease.bump(span(b.a, b.b, frame));',
    to: 'v[b.prop] += b.size * ease.bump(span(b.a, b.b + 1, frame));',
    expect: 'cues: the blink closes on its middle frame, and every bump peaks there',
  },
  {
    why: 'a scene change starts a frame before its shot boundary',
    file: 'examples/cues.js',
    from: '          const onset = B + Math.round((p * spread) / (PARTS.length - 1));',
    to: '          const onset = B - 1 + Math.round((p * spread) / (PARTS.length - 1));',
    expect: 'cues: each scene change starts on its boundary and reaches the parts one by one',
  },
  {
    why: 'each note of a scene change sounds a frame after the picture shows it',
    file: 'examples/cues.js',
    from: '      const at = c.onset / timeline.hz;',
    to: '      const at = (c.onset + 1) / timeline.hz;',
    expect: 'cues: each note sounds on the frame that first shows its part turning',
  },

  // --- static layers ----------------------------------------------------------
  {
    why: 'a layer copied at one device scale is put back at another',
    file: 'core/layer.js',
    from: "  const id = `${key}@${at.scale}:${box.join(',')}:${g.canvas.width}x${g.canvas.height}`;",
    to: "  const id = `${key}:${box.join(',')}:${g.canvas.width}x${g.canvas.height}`;",
    expect: 'each device scale keeps its own copy',
  },
  {
    why: 'a copy taken from one canvas is put on another',
    file: 'core/layer.js',
    from: '  let solves = caches.get(g.canvas);\n  if (!solves) caches.set(g.canvas, solves = new WeakMap());',
    to: '  let solves = caches.get(caches);\n  if (!solves) caches.set(caches, solves = new WeakMap());',
    expect: 'a copy belongs to its canvas and its solve',
  },
  {
    why: 'layers are kept past the pixel cap',
    file: 'core/layer.js',
    from: '  const copy = cache.pixels + at.w * at.h <= cap ? keep(g, state, at, paint) : null;',
    to: '  const copy = keep(g, state, at, paint);',
    expect: 'past the cap a layer is drawn every time',
  },
  {
    why: 'a translucent layer is kept, so its copy carries what lay under it',
    file: 'core/layer.js',
    from: '  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return null;',
    to: '  for (let i = 3; i < px.length; i += 4) if (false) return null;',
    expect: 'a translucent layer is drawn every time, never copied',
  },
  {
    why: 'a paint that takes the playhead is accepted',
    file: 'core/layer.js',
    from: "  if (typeof paint !== 'function' || paint.length > 2) {",
    to: "  if (typeof paint !== 'function') {",
    expect: 'a paint that takes a playhead is refused by name',
  },
  {
    why: 'a finish is applied to a surface with no pixels, so an SVG carries raster passes',
    file: 'core/render.js',
    from: '  const film = !!(piece.finish && surface.canvas);',
    to: '  const film = !!piece.finish;',
    expect: 'a finish is drawn only where there are pixels',
  },
  {
    why: 'the gate never moves the picture',
    file: 'core/render.js',
    from: '    if (film) weave(surface, piece, solved, clock.frame);',
    to: '    if (false) weave(surface, piece, solved, clock.frame);',
    expect: 'the weave never uncovers an edge',
  },
  {
    why: 'the picture is not enlarged for the weave, so an edge shows',
    file: 'core/finish.js',
    from: '  const z = 1 + (2 * a) / Math.min(w, h);',
    to: '  const z = 1;',
    expect: 'the weave never uncovers an edge',
  },
  {
    why: 'the weave reaches past its declared amplitude',
    file: 'core/finish.js',
    from: "  return [weave * wander('finish weave x'), 0.5 * weave * wander('finish weave y')];",
    to: "  return [2 * weave * wander('finish weave x'), 0.5 * weave * wander('finish weave y')];",
    expect: 'the weave never uncovers an edge',
  },
  {
    why: 'the grain holds one offset, so it sits on the picture like a screen instead of boiling',
    file: 'core/finish.js',
    from: "      const ox = Math.floor(s.R('finish grain', 'x', frame) * TILE);\n      const oy = Math.floor(s.R('finish grain', 'y', frame) * TILE);",
    to: "      const ox = Math.floor(s.R('finish grain', 'x', 0) * TILE);\n      const oy = Math.floor(s.R('finish grain', 'y', 0) * TILE);",
    expect: 'the grain boils: a new offset on every frame',
  },
  {
    why: 'the finish ignores the seed',
    file: 'core/finish.js',
    from: '  if (!s) solves.set(solved.state, s = { R: rng(solved.seed), tile: null });',
    to: '  if (!s) solves.set(solved.state, s = { R: rng(1), tile: null });',
    expect: 'grain is a function of the seed and the frame',
  },
  {
    why: 'one grain tile is kept for every solve, so a re-roll keeps the last seed\'s grain',
    file: 'core/finish.js',
    from: '  let s = solves.get(solved.state);\n  if (!s) solves.set(solved.state, s',
    to: '  let s = solves.get(solves);\n  if (!s) solves.set(solves, s',
    expect: 'grain is a function of the seed and the frame',
  },
  {
    why: 'the grain is multiplied in, so it only darkens',
    file: 'core/finish.js',
    from: "      pass('soft-light', f.grain,",
    to: "      pass('multiply', f.grain,",
    expect: 'the passes run in print order: grain, grade, flicker, vignette',
  },
  {
    why: 'the vignette darkens the middle and clears the corners',
    file: 'core/finish.js',
    from: "      v.addColorStop(0, 'rgba(0,0,0,0)');\n      v.addColorStop(1, '#000000');",
    to: "      v.addColorStop(0, '#000000');\n      v.addColorStop(1, 'rgba(0,0,0,0)');",
    expect: 'the passes run in print order: grain, grade, flicker, vignette',
  },
  {
    why: 'the grade multiplies by white alone, so white lands past it once black is screened in',
    file: 'core/finish.js',
    from: "      pass('multiply', 1, hex([0, 1, 2].map((i) => (W[i] - B[i]) / (1 - B[i]))));",
    to: "      pass('multiply', 1, hex(W));",
    expect: 'the grade maps black and white where the print holds them',
  },
  {
    why: 'flicker dips by up to the whole exposure, not its declared amount',
    file: 'core/finish.js',
    from: "f.flicker * s.R('finish flicker', 'dip', frame)",
    to: "s.R('finish flicker', 'dip', frame)",
    expect: 'flicker dims a frame by at most its amount',
  },
  {
    why: 'the finish leaves its transform and composite operation on the surface',
    file: 'core/finish.js',
    from: '  } finally {\n    g.restore();\n  }\n}',
    to: '  } finally {\n  }\n}',
    expect: 'the finish leaves the surface as it found it',
  },
  {
    why: 'a misspelled finish part is accepted and does nothing',
    file: 'core/finish.js',
    from: '  if (extra.length) return `unknown key(s) in finish: ${extra.join(\', \')}; known: ${PARTS.join(\', \')}`;',
    to: '  if (false) return `unknown key(s) in finish: ${extra.join(\', \')}; known: ${PARTS.join(\', \')}`;',
    expect: 'a finish is validated by name',
  },
  {
    why: 'a grade whose white is darker than its black is accepted',
    file: 'core/finish.js',
    from: '  if (![0, 1, 2].every((i) => W[i] > B[i]))',
    to: '  if (false)',
    expect: 'a finish is validated by name',
  },
  {
    why: 'a still takes a film finish',
    file: 'core/piece.js',
    from: '  if (out.finish && !out.time) {',
    to: '  if (false) {',
    expect: 'a still refuses a finish',
  },
  {
    why: "drift's ground reads the playhead, so its copied frames freeze the ground",
    file: 'examples/drift.js',
    from: "    layer(g, s, 'ground', [0, 0, W, H], ground);",
    to: "    layer(g, s, 'ground', [0, 0, W, H], (lg) => ground(lg, { ...s, hue: s.hue + t * 90 }));",
    expect: 'layers: a frame whose static layer was copied holds the marks drawing it would',
  },
  {
    why: 'render scale is ignored entirely, so a print is the size of a screen',
    file: 'core/render.js',
    from: '  if (scale !== 1 && surface.scale) surface.scale(scale, scale);',
    to: '  if (false && surface.scale) surface.scale(scale, scale);',
    expect: 'N7 -- macro geometry is preserved from 1x to 8x',
  },
// --- the accessors that were implemented and never once run ---------------
  {
    why: 'strokeRect fills instead of stroking, so it means one thing live and another on export',
    file: 'core/surface-vector.js',
    from: 'strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); return this.stroke(); }',
    to: 'strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); return this.fill(); }',
    expect: 'strokeRect is a rect and a stroke, so the live path and the vector path agree',
  },
  {
    why: 'resetTransform is a no-op, so a caller escaping a transform stack keeps it',
    file: 'core/surface-vector.js',
    from: 'resetTransform() { this._st.m = [1, 0, 0, 1, 0, 0]; return this; }',
    to: 'resetTransform() { return this; }',
    expect: 'resetTransform drops the whole transform stack back to identity',
  },
  {
    why: 'a mitre limit is written for joins that have no mitre',
    file: 'core/surface-vector.js',
    from: "st.lineJoin === 'miter' && st.miterLimit !== 10 ?",
    to: 'st.miterLimit !== 10 ?',
    expect: 'miterLimit reaches the document, and only where it can matter',
  },
  {
    why: 'the dash offset ignores the transform, so a print comes back with screen-sized dashes',
    file: 'core/surface-vector.js',
    from: 'stroke-dashoffset="${n(st.lineDashOffset * k)}"',
    to: 'stroke-dashoffset="${n(st.lineDashOffset)}"',
    expect: 'a dash offset is written, and scales with the transform like the dashes do',
  },
  {
    why: 'getLineDash hands out the live array, so a caller can change the surface by accident',
    file: 'core/surface-vector.js',
    from: 'getLineDash() { return this._st.lineDash.slice(); }',
    to: 'getLineDash() { return this._st.lineDash; }',
    expect: 'getLineDash hands back a copy, so a caller cannot reach in and change it',
  },
  {
    why: 'setTransform composes instead of replacing, so a piece cannot escape an outer transform',
    file: 'core/surface-vector.js',
    from: 'setTransform(a, b, c, d, e, f) { this._st.m = [a, b, c, d, e, f]; return this; }',
    to: 'setTransform(a, b, c, d, e, f) { this._st.m = mul(this._st.m, [a, b, c, d, e, f]); return this; }',
    expect: 'setTransform REPLACES the transform where transform() multiplies it',
  },

  // --- the frame lattice --------------------------------------------------
  {
    why: 'a piece that does not loop is walked on the looping lattice, so a frame is lost',
    file: 'core/piece.js',
    from: '  return piece.time.loop ? n : n - 1;',
    to: '  return n;',
    expect: 'playheads visits EVERY drawn frame exactly once, and none of them twice',
  },
  {
    why: 'playheads samples the grid instead of walking it -- the original dropped-frame bug',
    file: 'core/render.js',
    from: '  return Array.from({ length: n }, (_, i) => i / den);',
    to: '  return Array.from({ length: n }, (_, i) => frameT(p, i / (n - 1)));',
    expect: 'playheads visits EVERY drawn frame exactly once, and none of them twice',
  },
  {
    why: 'a looping playhead does not wrap, so t=1 is a frame past the end',
    file: 'core/piece.js',
    from: '    return Math.round(tt * n) % n;',
    to: '    return Math.round(tt * n);',
    expect: 'the frame index is an integer in [0, frames-1] wherever the playhead lands',
  },
  {
    why: 'the clock reports seconds against the duration instead of the draw rate',
    file: 'core/piece.js',
    from: '    seconds: piece.time ? frame / piece.time.hz : 0,',
    to: '    seconds: piece.time ? frame / piece.time.duration : 0,',
    expect: 'draw is handed a clock, so a piece need not restate its own timeline',
  },
  {
    why: 'draw is handed the playhead and nothing else, so a piece must restate its own timeline',
    file: 'core/render.js',
    from: '    piece.draw(surface, solved.state, tt, clock);',
    to: '    piece.draw(surface, solved.state, tt);',
    expect: 'draw is handed a clock, so a piece need not restate its own timeline',
  },

  // --- the measuring instrument ---------------------------------------------
  {
    why: 'the harness loses a surface operation, and quietly forbids an example from using it',
    file: 'tests/examples.test.js',
    from: '  roundRect(x, y, w, h, radii = 0) {',
    to: '  roundRectRemoved(x, y, w, h, radii = 0) {',
    expect: 'THE RECORDER IMPLEMENTS THE WHOLE SURFACE, so the suite cannot narrow the art',
  },
  {
    why: 'an arc is recorded as a point, so a piece of pure discs passes the resolution check',
    file: 'tests/examples.test.js',
    from: '    const k = this._rad(x, y, rad);',
    to: '    const k = rad * this._k; this._pt(x, y);',
    expect: 'the recorder sees an arc as an area, not as a point',
  },
  {
    why: 'an arc forgets its sweep, so a change of phase is invisible to every determinism check',
    file: 'tests/examples.test.js',
    from: "    const key = `A${r(this._x(x, y))},${r(this._y(x, y))},${r(k)},${r(a)},${r(b)},${ccw ? 1 : 0}`",
    to: "    const key = `A${r(this._x(x, y))},${r(this._y(x, y))},${r(k)}`",
    expect: 'the recorder sees an arc sweep, so a change of phase cannot hide',
  },

  // --- the delivery tool ------------------------------------------------------
  {
    why: 'the page builder writes a bundle with a hole in it and exits 0',
    file: 'tools/build-page.js',
    from: '  if (bad.length) {',
    to: '  if (false) {',
    expect: 'the page builder refuses to write a bundle with a hole in it',
  },
  {
    why: 'the page builder goes back to a hand-maintained module list',
    file: 'tools/build-page.js',
    from: "    ...files('examples').filter((f) => f !== 'examples/index.js'),",
    to: "    'examples/drift.js',",
    expect: 'the page builder refuses to write a bundle with a hole in it',
  },
  {
    why: 'a film that plays in bursts is saved, because every frame is there and the duration is right',
    file: 'tools/build-page.js',
    from: '  if (Math.abs(v.medianGapMs - budget) > budget * 0.1 || v.p95GapMs > budget * 1.5 || v.maxGapMs > budget * 3) {',
    to: '  if (false) {',
    expect: 'a film with every frame and uneven spacing is refused, and so is one missing a frame',
  },
  {
    why: 'a complete single-frame film is rejected for having no spacing interval',
    file: 'tools/build-page.js',
    from: '  if (expected === 1) return v;',
    to: '',
    expect: 'a single-frame film needs exactly one frame and no spacing interval',
  },
  {
    why: 'one long freeze is let through, because it moves neither the median nor the p95',
    file: 'tools/build-page.js',
    from: ' || v.maxGapMs > budget * 3) {',
    to: ') {',
    expect: 'a film with every frame and uneven spacing is refused, and so is one missing a frame',
  },
  {
    why: 'a film missing pictures is saved as long as the ones it has are evenly spaced',
    file: 'tools/build-page.js',
    from: '  if (v.frames !== expected) {',
    to: '  if (false) {',
    expect: 'a film with every frame and uneven spacing is refused, and so is one missing a frame',
  },
  {
    why: 'a block forgets which cluster it is in, so every cluster restarts the film at zero',
    file: 'tools/build-page.js',
    from: '      out.push((cluster + ((uint(at, 2) << 16) >> 16)) * scale / 1000000);',
    to: '      out.push(((uint(at, 2) << 16) >> 16) * scale / 1000000);',
    expect: 'a film is read from the blocks its FILE holds, by walking it rather than scanning it',
  },
  {
    why: 'EBML sizes go back to marker plus value less the marker, which floating point rounds for 8-byte sizes',
    file: 'tools/build-page.js',
    from: '  for (let i = 1; i < sizeLen; i++) { size = size * 256 + bytes[at + idLen + i]; unknown = unknown && bytes[at + idLen + i] === 0xFF; }',
    to: '  for (let i = 1; i < sizeLen; i++) { size = size * 256 + bytes[at + idLen + i]; unknown = unknown && bytes[at + idLen + i] === 0xFF; }\n  size = size + 2 ** (7 * sizeLen) - 2 ** (7 * sizeLen);',
    expect: 'every EBML size is read exactly, at every length up to 8 bytes',
  },
  {
    why: 'a saved WebM states its length in milliseconds whatever unit its file declares',
    file: 'tools/build-page.js',
    from: '    const units = (seconds * 1e9) / scale;',
    to: '    const units = seconds * 1000;',
    expect: 'a recorded WebM is saved with its length, and every other byte as recorded',
  },
  {
    why: 'an added Duration leaves Info its old size, so a reader stops short of it',
    file: 'tools/build-page.js',
    from: '  if (parent) ebmlResize(src, parent, parent.size + added.length);',
    to: '',
    expect: 'a recorded WebM is saved with its length, and every other byte as recorded',
  },


  // --- shared arithmetic --------------------------------------------------
  {
    why: 'turn takes the long way round, so a heading swings back across the wrap',
    file: 'core/num.js',
    from: '  if (d > half) d -= period;',
    to: '  if (false) d -= period;',
    expect: 'turn takes the SHORT way round, including across the wrap',
  },
  {
    why: 'turn ignores its period, so undirected marks steer as if they had a direction',
    file: 'core/num.js',
    from: 'function turn(from, to, period = Math.PI * 2) {',
    to: 'function turn(from, to, ignored = Math.PI * 2) { const period = Math.PI * 2;',
    expect: 'turn with period PI is for marks that have no direction',
  },
  {
    why: 'pick falls off the end of its list when the value is exactly 1',
    file: 'core/num.js',
    from: '  return list[Math.min(list.length - 1, Math.floor(clamp01(u) * list.length))];',
    to: '  return list[Math.floor(clamp01(u) * list.length)];',
    expect: 'pick covers the whole list and never falls off the end',
  },
  {
    why: 'a centred draw is narrowed, so every seed comes out a sibling of the last',
    file: 'core/num.js',
    from: '  return (u + v) / 2;',
    to: '  return (u + v + 0.5) / 3;',
    expect: 'centred is a TRIANGULAR draw, and two is not three',
  },
  {
    why: 'smoothstep is a straight line, so nothing eases',
    file: 'core/num.js',
    from: '  return u * u * (3 - 2 * u);',
    to: '  return u;',
    expect: 'smoothstep is flat at both edges and steepest in the middle',
  },

  // --- colour, in the light it is actually mixed in --------------------------
  {
    why: 'colours are mixed in DISPLAY space, so every midpoint comes out a stop dark',
    file: 'core/colour.js',
    from: '  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;',
    to: '  return c;',
    expect: 'MIXING HAPPENS IN LINEAR LIGHT, which is the whole point of the module',
  },
  {
    why: 'the sRGB encode is dropped, so a value fitted in linear light is written out raw',
    file: 'core/colour.js',
    from: '  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;',
    to: '  return c;',
    expect: 'sRGB encode and decode are inverses',
  },
  {
    why: 'readableOn guesses instead of measuring, so type goes on the wrong ground',
    file: 'core/colour.js',
    from: '    if (c > score) { score = c; best = o; }',
    to: '    if (c < score) { score = c; best = o; }',
    expect: 'contrast is symmetric and bounded, and readableOn measures rather than assumes',
  },
  {
    why: 'a hex value is emitted without clamping, so an out-of-range colour becomes nonsense',
    file: 'core/colour.js',
    from: "  const byte = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');",
    to: "  const byte = (v) => Math.round(v * 255).toString(16).padStart(2, '0');",
    expect: 'hex parses three, four, six and eight digits, and round-trips',
  },
  {
    why: 'a mistyped OKLab coefficient shifts every perceptual colour',
    file: 'core/colour.js',
    from: '  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;',
    to: '  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8186757660 * s;',
    expect: 'oklch matches the published OKLCh of the sRGB primaries',
  },
  {
    why: 'the hue is lerped raw, so a perceptual mix sometimes turns the long way round',
    file: 'core/colour.js',
    from: '  const h = p[2] + turn(p[2], q[2]) * k;',
    to: '  const h = p[2] + (q[2] - p[2]) * k;',
    expect: 'MIXOKLCH KEEPS THE COLOUR that a linear mix loses between complements',
  },
  {
    why: 'a grey keeps its rounding-noise hue, so grey to red passes through orange',
    file: 'core/colour.js',
    from: '  if (p[1] < 1e-4) p[2] = q[2];',
    to: '  if (false) p[2] = q[2];',
    expect: 'a grey has no hue of its own in mixOklch, so it fades straight into the colour',
  },
  {
    why: 'an out-of-gamut perceptual mix is clipped per channel, shifting its lightness and hue',
    file: 'core/colour.js',
    from: '  if (!inGamut(linearOf(L, C, h))) {',
    to: '  if (false) {',
    expect: 'where mixOklch leaves sRGB, chroma gives way, never lightness or hue',
  },

  // --- polylines, and the design box ----------------------------------------
  {
    why: 'THE CROSSBAR AGAIN: the polyline helper filters a two-point run',
    file: 'core/path.js',
    from: '  if (!pts || pts.length === 0) return g;',
    to: '  if (!pts || pts.length < 3) return g;',
    expect: 'a two-point run is a polyline like any other',
  },
  {
    why: 'a clipped line is rejoined across the gap, drawing a stroke the piece never asked for',
    file: 'core/path.js',
    from: '    if (run && same(run[run.length - 1], seg[0])) run.push(seg[1]);',
    to: '    if (run) run.push(seg[1]);',
    expect: 'a line that leaves the box and comes back returns as TWO runs',
  },
  {
    why: 'a run that grazes a corner is kept, so a plotter lifts and puts down for nothing',
    file: 'core/path.js',
    from: '  return runs.filter((r) => r.some((q) => !same(q, r[0])));',
    to: '  return runs;',
    expect: 'a segment that only grazes a corner is a pen lift, not a mark',
  },
  {
    why: 'the design box ignores its inset, so a piece clips to the bleed',
    file: 'core/path.js',
    from: '  return [inset, inset, size.w - inset, size.h - inset];',
    to: '  return [0, 0, size.w, size.h];',
    expect: 'clipping keeps what is inside the design box and drops what is not',
  },
  {
    why: 'a clipped endpoint aliases a caller-owned point instead of returning a detached copy',
    file: 'core/path.js',
    from: '    [a[0] + t0 * dx, a[1] + t0 * dy],',
    to: '    a,',
    expect: 'clipSegment returns detached endpoint pairs without changing its inputs',
  },

  // --- the instrument the documentation names and did not ship ---------------
  {
    why: 'the contact sheet rolls its seeds, so nobody can point at the bad one twice',
    file: 'tools/contact-sheet.js',
    from: '      cells.push({ seed: paramNames.length ? p.seed : x + 1, params });',
    to: '      cells.push({ seed: paramNames.length ? p.seed : Math.floor(Math.random() * 1000), params });',
    expect: 'the contact sheet renders reproducible seeds, not random ones',
  },
  {
    why: 'a parameter sweep changes seeds between cells, confounding the comparison',
    file: 'tools/contact-sheet.js',
    from: '      cells.push({ seed: paramNames.length ? p.seed : x + 1, params });',
    to: '      cells.push({ seed: x + 1, params });',
    expect: 'contact sheet: a strip includes exact endpoints and holds the piece seed and other parameters fixed',
  },
  {
    why: 'the two parameter axes are swapped without changing the labels',
    file: 'tools/contact-sheet.js',
    from: 'sample(key, axis ? y : x)',
    to: 'sample(key, axis ? x : y)',
    expect: 'contact sheet: a grid covers the Cartesian product with the first parameter in columns',
  },


  // --- the memo: an optimisation must not become a change ------------------
  {
    why: 'the memo stores a hash that is not the address\'s, so the second read of an address differs from the first',
    file: 'core/rand.js',
    from: '        inner.set(property, h);',
    to: '        inner.set(property, h + 1);',
    expect: 'ONE SOURCE, ASKED TWICE, ANSWERS THE SAME',
  },
  {
    why: 'the memo is keyed on the index too, so it never hits and the seed still works',
    file: 'core/rand.js',
    from: '      h = fnv1a(SEP + property, fnv1a(entity, base));',
    to: '      h = fnv1a(SEP + property, fnv1a(entity, base + index));',
    expect: 'ONE SOURCE, ASKED TWICE, ANSWERS THE SAME',
  },
  {
    why: 'every fbm octave gets the SAME cached name, so the octaves collapse',
    file: 'core/rand.js',
    from: '  for (let o = ns.length; o < octaves; o++) ns.push(`${name}/${o}`);',
    to: '  for (let o = ns.length; o < octaves; o++) ns.push(`${name}/0`);',
    expect: 'fbm octaves are separate fields, not one field read at two scales',
  },
  {
    why: 'the octaves double exactly again, so every octave lattice line lands on the integers and the field goes flat on a grid',
    file: 'core/rand.js',
    from: 'const LACUNARITY = 2.17;',
    to: 'const LACUNARITY = 2;',
    expect: 'fbm has no dead lines: its gradient on the integer lattice is not near zero',
  },
  {
    why: 'the gradient table is never indexed, so every cell leans the same way and the field is a ramp rather than a field',
    file: 'core/rand.js',
    from: "  const g = GRADS[Math.floor(R(name, 'grad', cell(i, j)) * GRADS.length)];",
    to: '  const g = GRADS[0];',
    expect: 'gradient2 stays in range, varies, and is a pure function of its arguments',
  },
  {
    why: 'the gradient index forgets the field NAME, so two named fields of gradient2 are one field',
    file: 'core/rand.js',
    from: "  const g = GRADS[Math.floor(R(name, 'grad', cell(i, j)) * GRADS.length)];",
    to: "  const g = GRADS[Math.floor(R('field', 'grad', cell(i, j)) * GRADS.length)];",
    expect: 'two named fields of gradient2 are independent at the same point',
  },
  {
    why: 'gradient noise gets a smoothstep fade instead of the quintic, so its second derivative steps across every cell boundary',
    file: 'core/rand.js',
    from: '  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);',
    to: '  const u = fx * fx * (3 - 2 * fx);',
    expect: "gradient2's curvature is continuous across a cell boundary, not stepped",
  },

  // --- geometry: the list three independent populations wrote ---------------
  {
    why: 'closest projection is not clamped, so distance is measured to the supporting line',
    file: 'core/geom.js',
    from: 'Math.max(0, Math.min(1, projection))',
    to: 'projection',
    expect: 'closest point clamps to the segment and measures from the returned point',
  },
  {
    why: 'nonbinary scaling destroys collinearity even for exact integer inputs',
    file: 'core/geom.js',
    from: '  const scale = 2 ** Math.min(1023, Math.floor(Math.log2(magnitude)));',
    to: '  const scale = magnitude;',
    expect: 'collinear overlap keeps both ends in the first segment direction',
  },
  {
    why: 'parallel separated segments are reported as an overlap',
    file: 'core/geom.js',
    from: '    if (cross(qx, qy, rx, ry) !== 0) return null;',
    to: "    if (cross(qx, qy, rx, ry) !== 0) return hit(a);",
    expect: 'intersection separates parallel segments and detects an interior crossing',
  },
  {
    why: 'collinear overlap discards its extent and returns only one point',
    file: 'core/geom.js',
    from: "    return { type: 'overlap', points: [[...start], [...end]] };",
    to: '    return hit(start);',
    expect: 'collinear overlap keeps both ends in the first segment direction',
  },
  {
    why: 'endpoint exclusion loses T junctions where one segment ends inside another',
    file: 'core/geom.js',
    from: '  if (t < 0 || t > 1 || u < 0 || u > 1) return null;',
    to: '  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;',
    expect: 'touching segment ends and T junctions are single point intersections',
  },
  {
    why: 'a zero-length segment hits every line even away from that line',
    file: 'core/geom.js',
    from: '    return cross(qx, qy, sx, sy) === 0 && within(a, c, d) ? hit(a) : null;',
    to: '    return hit(a);',
    expect: 'zero-length segments intersect only when their point belongs to the other segment',
  },
  {
    why: 'the offset ignores its miter limit and grows a sharp-corner spike',
    file: 'core/geom.js',
    from: '    if (ratio <= miterLimit) {',
    to: '    if (Number.isFinite(ratio)) {',
    expect: 'offset miter limit bevels sharp corners and reversals instead of growing spikes',
  },
  {
    why: 'repeated offset vertices create zero-length normals and nonfinite output',
    file: 'core/geom.js',
    from: '    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) src.push([...p]);',
    to: '    src.push([...p]);',
    expect: 'offset collapses repeated vertices and copies empty or directionless input',
  },
  {
    why: 'offset takes the wrong normal and swaps left and right',
    file: 'core/geom.js',
    from: '    normals.push([-uy / len, ux / len]);',
    to: '    normals.push([uy / len, -ux / len]);',
    expect: 'open offsets use signed perpendicular distance, miter corners and butt ends',
  },
  {
    why: 'the centroid is the mean of the vertex list, so a crowded edge drags it',
    file: 'core/geom.js',
    from: '    const w = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];',
    to: '    const w = 1;',
    expect: 'THE CENTROID IS OF THE AREA, NOT OF THE VERTEX LIST',
  },
  {
    why: 'point-in-polygon answers from the bounding box, so a notch reads as solid',
    file: 'core/geom.js',
    from: '      if (x < pts[i][0] + t * (pts[j][0] - pts[i][0])) hit = !hit;',
    to: '      if (x < Infinity) hit = !hit;',
    expect: 'pointInPoly answers inside and outside, including a concave notch',
  },
  {
    why: 'resample drops the tail, so every mark is short by its own fraction of a step',
    file: 'core/geom.js',
    from: '  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push([last[0], last[1]]);',
    to: '  if (false) out.push([last[0], last[1]]);',
    expect: 'THE LAST POINT SURVIVES A LENGTH THAT IS NOT A WHOLE NUMBER OF STEPS',
  },
  {
    why: 'resample carries no remainder between segments, so spacing restarts at every vertex',
    file: 'core/geom.js',
    from: '    carry = seg - (d - spacing);',
    to: '    carry = 0;',
    expect: 'resample spaces points along the LENGTH, not along the index',
  },
  {
    why: 'an open line loses its ends to the corner cutter, so nothing meets anything',
    file: 'core/geom.js',
    from: "    if (!close) out.push([cur[0][0], cur[0][1]]);",
    to: '    if (false) out.push([cur[0][0], cur[0][1]]);',
    expect: 'chaikin cuts corners, and an OPEN line keeps both of its ends exactly',
  },
  {
    why: 'the chainer only walks forwards, so a line handed over backwards stays in pieces',
    file: 'core/geom.js',
    from: '      for (let more = step(head); more; more = step(head)) {',
    to: '      for (let more = null; more; more = step(head)) {',
    expect: 'a chain extends BACKWARDS as well as forwards',
  },
  {
    why: 'the chainer matches on x alone, so two lines at different heights fuse',
    file: 'core/geom.js',
    from: '  const same = (a, b) => a[0] === b[0] && a[1] === b[1];',
    to: '  const same = (a, b) => a[0] === b[0];',
    expect: 'scrambled, mixed-direction segments chain into ONE closed ring',
  },
  {
    why: 'the ribbon offsets both sides the same way, so a tapered mark is a line',
    file: 'core/geom.js',
    from: '    right.push([pts[i][0] - nx, pts[i][1] - ny]);',
    to: '    right.push([pts[i][0] + nx, pts[i][1] + ny]);',
    expect: 'ribbon turns a varying weight into a shape a single-width pen can draw',
  },
  {
    why: 'ring ignores the radius it is handed, so every form is the same circle',
    file: 'core/geom.js',
    from: '    const r = radiusAt(a, i, n);',
    to: '    const r = 1;',
    expect: 'ring is a constructor, not a look: a constant radius is a circle',
  },
  {
    why: 'field samples are stored by column, so non-square scalar grids are transposed',
    file: 'core/field.js',
    from: 'values[j * (cols + 1) + i] = vector',
    to: 'values[i * (rows + 1) + j] = vector',
    expect: 'sampleGrid covers every vertex in row order in the requested domain',
  },
  {
    why: 'the derivative omits its coordinate step, so changing epsilon changes its magnitude',
    file: 'core/field.js',
    from: '(finiteScalar(field(x + epsilon, y)) - finiteScalar(field(x - epsilon, y))) / (2 * epsilon)',
    to: '(finiteScalar(field(x + epsilon, y)) - finiteScalar(field(x - epsilon, y))) / 2',
    expect: 'gradient recovers analytic derivatives with independent axes and coordinate units',
  },
  {
    why: 'curl loses its negative component, so the flow crosses its potential contours',
    file: 'core/field.js',
    from: '    return [dy, -dx];',
    to: '    return [dy, dx];',
    expect: 'curl is tangent to potential contours and has zero divergence',
  },
  {
    why: 'domain warp ignores its signed amplitude on one axis',
    file: 'core/field.js',
    from: 'finiteScalar(x + dx * amount)',
    to: 'finiteScalar(x + dx)',
    expect: 'warp displaces the domain once and preserves scalar or vector results',
  },
  {
    why: 'threshold discards samples exactly at the requested cut',
    file: 'core/field.js',
    from: 'finiteScalar(field(x, y)) >= level ? 1 : 0',
    to: 'finiteScalar(field(x, y)) > level ? 1 : 0',
    expect: 'threshold places equality on the high side without changing field coordinates',
  },
  {
    why: 'isolines return disconnected cell segments as paths, multiplying pen lifts',
    file: 'core/field.js',
    from: 'return { segments, paths: chain(segments) };',
    to: 'return { segments, paths: segments };',
    expect: 'isolines interpolate a linear field and chain cell edges into one path per level',
  },
  {
    why: 'one saddle orientation always chooses the same diagonal regardless of the centre',
    file: 'core/field.js',
    from: 'case 5:\n          if ((tl + tr + br + bl) / 4 > level)',
    to: 'case 5:\n          if (true)',
    expect: 'isolines resolve both saddle orientations using the centre value',
  },
  {
    why: 'streamline steering takes a long turn when crossing the positive pi boundary',
    file: 'core/field.js',
    from: '    if (d > Math.PI) d -= Math.PI * 2;',
    to: '    if (false) d -= Math.PI * 2;',
    expect: 'streamline steering takes the short turn across both sides of pi',
  },
  {
    why: 'a streamline appends points outside its requested drawing bounds',
    file: 'core/field.js',
    from: '    if (outside(x, y)) break;',
    to: '    if (false) break;',
    expect: 'streamline records bounded starts and stops before an outside point or zero vector',
  },
  {
    why: 'streamline batches reset the physical step and ignore the caller option',
    file: 'core/field.js',
    from: 'return seeds.map((start) => streamline(field, start, opt));',
    to: 'return seeds.map((start) => streamline(field, start, { ...opt, step: 1 }));',
    expect: 'streamlines follow a constant vector with fixed physical step and independent seeds',
  },
  {
    why: 'a full circle stops after its first SVG half-arc and loses half its circumference',
    file: 'core/surface-vector.js',
    from: '      for (let i = 1; i <= count; i++) {',
    to: '      for (let i = 1; i <= 1; i++) {',
    expect: 'a full arc is an exact circle serialized as two SVG arcs',
  },
  {
    why: 'reflected elliptical arcs keep their original sweep and traverse the wrong side',
    file: 'core/surface-vector.js',
    from: 'const sweep = (d > 0) !== similarity.reflected ? 1 : 0;',
    to: 'const sweep = d > 0 ? 1 : 0;',
    expect: 'similarity arcs transform both ellipse axes and reverse reflected sweeps',
  },
  {
    why: 'nonuniform and sheared transforms take the similarity shortcut and change the ellipse',
    file: 'core/surface-vector.js',
    from: 'if (Math.abs(x - y) > tolerance || Math.abs(a * c + b * d) > tolerance) return null;',
    to: 'if (false) return null;',
    expect: 'shear and singular transforms retain cubic arcs while roundoff rotations use SVG arcs',
  },
  {
    why: 'opposite-direction whole turns collapse to an empty path instead of traversing the ellipse',
    file: 'core/surface-vector.js',
    from: 'if (d === 0 && a1 !== a0) d = ccw ? -TAU : TAU;',
    to: 'if (false) d = ccw ? -TAU : TAU;',
    expect: 'arc serialization preserves zero, full, multiple and nearly full turns',
  },
  {
    why: 'an SVG arc leaves the logical current point at its start and bends the following quadratic',
    file: 'core/surface-vector.js',
    from: '        this._cur = point;',
    to: '        this._cur = p0;',
    expect: 'an SVG arc updates the current point for the following quadratic and closes its subpath',
  },
  {
    why: 'the transform snapshot omits horizontal translation',
    file: 'core/surface-vector.js',
    from: '    return { a, b, c, d, e, f };',
    to: '    return { a, b, c, d, e: 0, f };',
    expect: 'vector and null surfaces report independently specified affine transform order',
  },
  {
    why: 'getTransform reuses a stale mutable snapshot instead of creating an independent object',
    file: 'core/surface-vector.js',
    from: '    return { a, b, c, d, e, f };',
    to: '    return this._snapshot || (this._snapshot = { a, b, c, d, e, f });',
    expect: 'transform snapshots are detached numeric objects and survive later surface changes',
  },
  {
    why: 'the benchmark advertises a no-op transform reader that returns undefined',
    file: 'tools/bench.js',
    from: '  g.getTransform = () => { g.calls++; return transforms.getTransform(); };',
    to: '  g.getTransform = noop;',
    expect: 'vector and null surfaces report independently specified affine transform order',
  },
  {
    why: 'the benchmark transform changes survive save and restore',
    file: 'tools/bench.js',
    from: "['save', 'restore', 'transform', 'setTransform', 'resetTransform', 'translate', 'scale', 'rotate']",
    to: "['transform', 'setTransform', 'resetTransform', 'translate', 'scale', 'rotate']",
    expect: 'vector and null transform stacks restore nested snapshots after replacement and reset',
  },
  {
    why: 'inversion ignores the portable transform reader and drops print-scale circle detail',
    file: 'examples/inversion.js',
    from: "    if (typeof g.getTransform === 'function') {",
    to: '    if (false) {',
    expect: 'inversion: vector and null transform readers preserve shared circles at higher output scale',
  },
  {
    why: 'sparse vector arrays bypass validation because Array.every skips missing components',
    file: 'core/field.js',
    from: '!Number.isFinite(value[0]) || !Number.isFinite(value[1])',
    to: '!value.every(Number.isFinite)',
    expect: 'field vectors require both finite components even in sparse arrays',
  },
  {
    why: 'positive ellipse radii round to zero in SVG and erase a still-visible thin axis',
    file: 'core/surface-vector.js',
    from: "    if (arcRx !== '0' && arcRy !== '0') {",
    to: '    if (hasRadii) {',
    expect: 'ellipses retain visible geometry when serialized radii round to zero',
  },
  {
    why: 'a still is accepted with a soundtrack it has no film for',
    file: 'core/piece.js',
    from: '  if (out.sound && !out.time) {',
    to: '  if (false) {',
    expect: 'a soundtrack is a function or nothing, and a still cannot have one',
  },
  {
    why: 'the soundtrack is cut to the declared duration instead of the frames the film holds',
    file: 'core/render.js',
    from: '  const duration = frames / piece.time.hz;',
    to: '  const duration = piece.time.duration;',
    expect: 'the soundtrack is exactly as long as the film, frames / hz, and says what it cannot do',
  },
  {
    why: 'the page\'s film scale shrinks a design box past 1920 pixels',
    file: 'core/film.js',
    from: '  return Math.max(1, LONG_EDGE / Math.max(piece.size.w, piece.size.h));',
    to: '  return LONG_EDGE / Math.max(piece.size.w, piece.size.h);',
    expect: 'the page\'s scale takes the long edge to 1920 pixels, never below the design box',
  },
  {
    why: 'the default film bitrate goes back to 0.12 bit per pixel',
    file: 'core/film.js',
    from: 'const BITS_PER_PIXEL = 0.45;',
    to: 'const BITS_PER_PIXEL = 0.12;',
    expect: 'the default bitrate follows the frame size and rate within its floor and ceiling, and the level declared holds any bitrate',
  },
  {
    why: 'a High profile level is declared for a bitrate past what it holds',
    file: 'core/film.js',
    from: "    if (bitrate <= 1250 * kbps) out.push('avc1.6400' + hex);",
    to: "    out.push('avc1.6400' + hex);",
    expect: 'the default bitrate follows the frame size and rate within its floor and ceiling, and the level declared holds any bitrate',
  },
  {
    why: 'a Main profile level is allowed High\'s bitrate',
    file: 'core/film.js',
    from: "    if (bitrate <= 1000 * kbps) out.push('avc1.4d00' + hex);",
    to: "    if (bitrate <= 1250 * kbps) out.push('avc1.4d00' + hex);",
    expect: 'the default bitrate follows the frame size and rate within its floor and ceiling, and the level declared holds any bitrate',
  },
  {
    why: 'a fractional or text bitrate reaches the encoder',
    file: 'core/film.js',
    from: '  if (opt.bitrate !== undefined && !(Number.isSafeInteger(opt.bitrate) && opt.bitrate > 0)) {',
    to: '  if (opt.bitrate !== undefined && !(opt.bitrate > 0)) {',
    expect: 'a bitrate that is no whole positive number, or that no level holds, is refused by name',
  },
  {
    why: 'the film\'s level is chosen without its bitrate',
    file: 'core/film.js',
    from: '  for (const codec of avcCodecs(width, height, hz, bitrate)) {',
    to: '  for (const codec of avcCodecs(width, height, hz)) {',
    expect: 'a bitrate that is no whole positive number, or that no level holds, is refused by name',
  },
  {
    why: 'the export drops the bitrate it is given',
    file: 'core/film.js',
    from: '  const config = await filmConfig(piece, env.VideoEncoder, { scale, bitrate: opt.bitrate });',
    to: '  const config = await filmConfig(piece, env.VideoEncoder, { scale });',
    expect: 'a bitrate that is no whole positive number, or that no level holds, is refused by name',
  },
  {
    why: 'the page films at the design box by default',
    file: 'tools/build-page.js',
    from: '  var scale = opts && opts.scale !== undefined ? opts.scale : film.filmScale(p);',
    to: '  var scale = opts && opts.scale !== undefined ? opts.scale : 1;',
    expect: 'the page films at 1920 pixels on the long edge unless told a scale, at the bitrate it is given',
  },
  {
    why: 'the page drops the bitrate a script gives its film',
    file: 'tools/build-page.js',
    from: '  }, { scale: scale, bitrate: opts && opts.bitrate, onProgress: opts && opts.onProgress });',
    to: '  }, { scale: scale, onProgress: opts && opts.onProgress });',
    expect: 'the page films at 1920 pixels on the long edge unless told a scale, at the bitrate it is given',
  },
  {
    why: 'the page\'s first film control films the design box',
    file: 'tools/build-page.js',
    from: '<button id="film1" data-film=""',
    to: '<button id="film1" data-film="1"',
    expect: 'the page films at 1920 pixels on the long edge unless told a scale, at the bitrate it is given',
  },
  {
    why: 'the page asks the encoder about the design box and exports at another size',
    file: 'tools/build-page.js',
    from: '        : film.filmConfig(p, VideoEncoder, { scale: film.filmScale(p) }).then(',
    to: '        : film.filmConfig(p, VideoEncoder).then(',
    expect: 'a browser that encodes the film H.264 offers only the MP4 export',
  },
  {
    why: 'the browser check expects a film at the design box',
    file: 'tools/check-browser.js',
    from: 'scale: Math.max(1, 1920 / Math.max(p.size.w, p.size.h)) };',
    to: 'scale: 1 };',
    expect: 'the browser check carries a shortfall into its film report, and refuses a film whose decoded loudness loudnessMatch refuses',
  },
  {
    why: 'the browser check draws its reference frames at the design box on a film-sized canvas',
    file: 'tools/check-browser.js',
    from: "api.render.drawFrame(fg, p, solved, heads[i], { scale: webm ? 1 : report.manifest.film.scale });",
    to: 'api.render.drawFrame(fg, p, solved, heads[i]);',
    expect: 'the browser check carries a shortfall into its film report, and refuses a film whose decoded loudness loudnessMatch refuses',
  },
  {
    why: 'a film missing frames passes its file check',
    file: 'core/film.js',
    from: '  if (v.samples !== expected.frames) {',
    to: '  if (false) {',
    expect: 'the film check refuses a file that disagrees with its frame grid, and says how',
  },
  {
    why: 'a soundtrack far shorter than its film passes the file check',
    file: 'core/film.js',
    from: '    if (!covered || heard > seconds + 2 * grain) {',
    to: '    if (false) {',
    expect: 'the film check refuses a file that disagrees with its frame grid, and says how',
  },
  {
    why: 'the reader stops checking that samples lie inside the media data',
    file: 'core/film.js',
    from: '          if (at < out.media[0] || at + x.sizes[sample] > out.media[1]) inside = false;',
    to: '          if (false) inside = false;',
    expect: 'the film check refuses a file that disagrees with its frame grid, and says how',
  },
  {
    why: 'the colour tag says full range, so a player spreads limited-range video past black and white',
    file: 'core/film.js',
    from: "const COLR = box('colr', ascii('nclx'), u16(1), u16(1), u16(1), u8(0));",
    to: "const COLR = box('colr', ascii('nclx'), u16(1), u16(1), u16(1), u8(0x80));",
    expect: 'every film is tagged limited-range BT.709, and the check refuses any other tag',
  },
  {
    why: 'the file check lets through a film tagged anything but limited-range BT.709',
    file: 'core/film.js',
    from: '  if (primaries !== 1 || transfer !== 1 || matrix !== 1 || fullRange) {',
    to: '  if (false) {',
    expect: 'every film is tagged limited-range BT.709, and the check refuses any other tag',
  },
  {
    why: 'the H.264 stream names a video format other than unspecified',
    file: 'core/film.js',
    from: 'put(1, 1); put(5, 3); put(0, 1);',
    to: 'put(1, 1); put(0, 3); put(0, 1);',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the H.264 stream says full range, so a player that ignores colr spreads every colour past black and white',
    file: 'core/film.js',
    from: 'put(5, 3); put(0, 1); put(1, 1);',
    to: 'put(5, 3); put(1, 1); put(1, 1);',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the H.264 stream writes its colours without the flag that announces them',
    file: 'core/film.js',
    from: 'put(0, 1); put(1, 1); put(1, 8);',
    to: 'put(0, 1); put(0, 1); put(1, 8);',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the H.264 stream says BT.601 primaries',
    file: 'core/film.js',
    from: 'put(1, 1); put(1, 8); put(1, 8); put(1, 8); };',
    to: 'put(1, 1); put(6, 8); put(1, 8); put(1, 8); };',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the H.264 stream says the sRGB transfer',
    file: 'core/film.js',
    from: 'put(1, 1); put(1, 8); put(1, 8); put(1, 8); };',
    to: 'put(1, 1); put(1, 8); put(13, 8); put(1, 8); };',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the H.264 stream says the BT.601 matrix',
    file: 'core/film.js',
    from: 'put(1, 1); put(1, 8); put(1, 8); put(1, 8); };',
    to: 'put(1, 1); put(1, 8); put(1, 8); put(6, 8); };',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'a VUI added to an SPS without one misses a flag, so every field after it shifts',
    file: 'core/film.js',
    from: 'signal(); put(0, 6);',
    to: 'signal(); put(0, 5);',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: "the avcC keeps the encoder's SPS, so a player that ignores colr guesses the colours",
    file: 'core/film.js',
    from: '  const avcC = avcCBt709(video.avcC);',
    to: '  const avcC = video.avcC;',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: "an SPS a sample repeats keeps the encoder's colours, so a stream that restarts there says two things",
    file: 'core/film.js',
    from: 'samples: video.samples.map((s) => sampleBt709(s.data, (avcC[4] & 3) + 1)),',
    to: 'samples: video.samples.map((s) => s.data),',
    expect: 'a sequence parameter set a sample repeats is tagged too, and a sample that is not whole NAL units is left alone',
  },
  {
    why: 'the rewritten SPS is not escaped, so its zero runs read as a start code',
    file: 'core/film.js',
    from: '    if (zeros >= 2 && b <= 3) { out.push(3); zeros = 0; }\n',
    to: '',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the SPS is read with its emulation-prevention bytes, so the signal type lands in the wrong place',
    file: 'core/film.js',
    from: '    if (i + 2 < nal.length && nal[i] === 0 && nal[i + 1] === 0 && nal[i + 2] === 3) { out.push(0, 0); i += 2; continue; }\n',
    to: '',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: "the SPS layout skips POC type 1's cycle, so such a stream is tagged in the wrong place",
    file: 'core/film.js',
    from: 'for (let i = 0, n = ue(); i < n; i++) se(); }',
    to: 'ue(); }',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the SPS layout ignores scaling lists, so such a stream is tagged in the wrong place',
    file: 'core/film.js',
    from: 'for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {',
    to: 'for (let i = 0; i < 0; i++) {',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the SPS layout takes a 4:4:4 profile for one without chroma fields',
    file: 'core/film.js',
    from: 'const HIGH_PROFILES = [100, 110, 122, 244,',
    to: 'const HIGH_PROFILES = [100, 110, 122,',
    expect: 'every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote',
  },
  {
    why: 'the reader skips an SPS a sample repeats, so a film whose samples say full range passes the check',
    file: 'core/film.js',
    from: '              if ((bytes[p + x.nalLength] & 31) === 7) x.sps.push(',
    to: '              if (false) x.sps.push(',
    expect: 'the film check refuses an H.264 stream whose colour description is missing or disagrees with colr',
  },
  {
    why: 'the file check reads only the first SPS',
    file: 'core/film.js',
    from: 'const stream = v.sps.find(',
    to: 'const stream = v.sps.slice(0, 1).find(',
    expect: 'the film check refuses an H.264 stream whose colour description is missing or disagrees with colr',
  },
  {
    why: 'the file check lets through an H.264 stream that states no colours',
    file: 'core/film.js',
    from: '  if (!v.sps.length || stream === null) {',
    to: '  if (false) {',
    expect: 'the film check refuses an H.264 stream whose colour description is missing or disagrees with colr',
  },
  {
    why: 'the file check lets through an H.264 stream that disagrees with colr',
    file: 'core/film.js',
    from: '  if (stream) {',
    to: '  if (false) {',
    expect: 'the film check refuses an H.264 stream whose colour description is missing or disagrees with colr',
  },
  {
    why: 'the conversion uses the BT.601 red weight, so every colour shifts against a BT.709 tag',
    file: 'core/film.js',
    from: 'const KR = 0.2126;',
    to: 'const KR = 0.299;',
    expect: 'drawn pixels become BT.709 limited-range NV12: luma per pixel, chroma per 2x2 block, translucency over black',
  },
  {
    why: 'luma is written full range, so white overflows the limited range',
    file: 'core/film.js',
    from: 'const yr = KR * 219 / 255, yg = KG * 219 / 255, yb = KB * 219 / 255;',
    to: 'const yr = KR, yg = KG, yb = KB;',
    expect: 'drawn pixels become BT.709 limited-range NV12: luma per pixel, chroma per 2x2 block, translucency over black',
  },
  {
    why: 'chroma is taken from one pixel of each block instead of the block, so colour edges fringe',
    file: 'core/film.js',
    from: 'const rs = r0 + r1 + r2 + r3, gs = g0 + g1 + g2 + g3, bs = b0 + b1 + b2 + b3;',
    to: 'const rs = 4 * r0, gs = 4 * g0, bs = 4 * b0;',
    expect: 'drawn pixels become BT.709 limited-range NV12: luma per pixel, chroma per 2x2 block, translucency over black',
  },
  {
    why: 'translucent pixels keep their colour instead of darkening over black, unlike the encoder given the canvas',
    file: 'core/film.js',
    from: '      if ((px[p + 3] & px[p + 7] & px[q + 3] & px[q + 7]) !== 255) {',
    to: '      if (false) {',
    expect: 'drawn pixels become BT.709 limited-range NV12: luma per pixel, chroma per 2x2 block, translucency over black',
  },
  {
    why: 'the frames say full range, so the encoder is told the samples mean something else',
    file: 'core/film.js',
    from: "const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };",
    to: "const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true };",
    expect: 'every frame reaches the encoder as BT.709 limited-range NV12, whatever the encoder reports',
  },
  {
    why: 'a canvas read back every frame starts on the GPU, and the browser moves it part-way through the film',
    file: 'core/film.js',
    from: "canvas.getContext('2d', { willReadFrequently: true })",
    to: "canvas.getContext('2d')",
    expect: 'every frame reaches the encoder as BT.709 limited-range NV12, whatever the encoder reports',
  },
  {
    why: 'the encoder route is never tried, so every export pays for the conversion',
    file: 'core/film.js',
    from: '  if (env.VideoDecoder && env.EncodedVideoChunk) {',
    to: '  if (false) {',
    expect: 'the encoder converts frames itself where both probes and every colour space it reports prove limited-range BT.709',
  },
  {
    why: 'the probe leaves its last colour on the canvas, so a piece that fills in the colour it finds draws another film on the encoder route',
    file: 'core/film.js',
    from: '  g.save();\n  g.clearRect(0, 0, w, h);',
    to: '  g.clearRect(0, 0, w, h);',
    expect: 'the encoder converts frames itself where both probes and every colour space it reports prove limited-range BT.709',
  },
  {
    why: 'a browser that makes no frame of the copy fails the export instead of converting it',
    file: 'core/film.js',
    from: "    try { film = await pass('encoder'); } catch (e) { film = null; }",
    to: "    film = await pass('encoder');",
    expect: 'an encoder that writes full range, changes range part-way or reports anything else gets its frames converted',
  },
  {
    why: "the film keeps the probes' one-frame shift, so every frame is stamped a frame late",
    file: 'core/film.js',
    from: 'chunks.map((x) => ({ ...x, timestamp: x.timestamp - shift }))',
    to: 'chunks.map((x) => ({ ...x }))',
    expect: 'the encoder converts frames itself where both probes and every colour space it reports prove limited-range BT.709',
  },
  {
    why: "a probe's chunk stays in the film",
    file: 'core/film.js',
    from: 'await probeCells(env, config, avcC, chunks.pop());',
    to: 'await probeCells(env, config, avcC, chunks[chunks.length - 1]);',
    expect: 'the encoder converts frames itself where both probes and every colour space it reports prove limited-range BT.709',
  },
  {
    why: 'the first probe goes unchecked, so a full-range encoder is handed the whole film before the last probe stops it',
    file: 'core/film.js',
    from: '      if (copy && !await probe(0)) return null;',
    to: '      if (copy) await probe(0);',
    expect: 'an encoder that writes full range, changes range part-way or reports anything else gets its frames converted',
  },
  {
    why: 'the last probe goes unchecked, so an encoder that changes range without saying so writes the rest of the film in full range',
    file: 'core/film.js',
    from: '      if (copy && !(await probe(shift + stamp(heads.length)) && spaces.every(limited709))) return null;',
    to: '      if (copy && !spaces.every(limited709)) return null;',
    expect: 'an encoder that writes full range, changes range part-way or reports anything else gets its frames converted',
  },
  {
    why: 'a probe passes at any level, so a full-range encoder is trusted',
    file: 'core/film.js',
    from: 'Math.abs(v - want[k][j]) <= 2',
    to: 'Math.abs(v - want[k][j]) <= 64',
    expect: 'an encoder that writes full range, changes range part-way or reports anything else gets its frames converted',
  },
  {
    why: 'the colour spaces the encoder reports go unread, so one that says full range is trusted on its probes',
    file: 'core/film.js',
    from: "const limited709 = (space) => !!space && space.primaries === 'bt709' && space.matrix === 'bt709' && space.fullRange === false;",
    to: 'const limited709 = () => true;',
    expect: 'an encoder that writes full range, changes range part-way or reports anything else gets its frames converted',
  },
  {
    why: 'a reported matrix goes unread, so an encoder that says BT.601 is trusted',
    file: 'core/film.js',
    from: " && space.matrix === 'bt709' && space.fullRange === false;",
    to: ' && space.fullRange === false;',
    expect: 'an encoder that writes full range, changes range part-way or reports anything else gets its frames converted',
  },
  {
    why: 'a change of range the encoder reports is noticed only after the last frame',
    file: 'core/film.js',
    from: '        if (copy && !spaces.every(limited709)) return null;\n',
    to: '',
    expect: 'an encoder that writes full range, changes range part-way or reports anything else gets its frames converted',
  },
  {
    why: 'frames are stamped by the wall clock instead of their place on the frame grid',
    file: 'core/film.js',
    from: '        const frame = frameAt(shift + stamp(i));',
    to: '        const frame = frameAt(shift + Math.round(now() * 1000));',
    expect: 'every drawn frame is encoded once, at its own timestamp, however slowly it draws',
  },
  {
    why: 'the H.264 level ignores the macroblock rate, so a fast film declares a level it exceeds',
    file: 'core/film.js',
    from: '    if (mw * mh > size || mw * mh * hz > rate || mw > side || mh > side) continue;',
    to: '    if (mw * mh > size || mw > side || mh > side) continue;',
    expect: 'the lowest H.264 level that fits is declared first, and the frame size is kept even',
  },
  {
    why: 'a browser that refuses AAC gets no film, although it encodes Opus',
    file: 'core/film.js',
    from: "  for (const codec of ['mp4a.40.2', 'opus']) {",
    to: "  for (const codec of ['mp4a.40.2']) {",
    expect: 'a piece with sound falls back to Opus where AAC is refused, and keeps AAC wherever it is offered',
  },
  {
    why: 'Opus is taken where AAC is offered, so a player that plays only AAC loses the sound',
    file: 'core/film.js',
    from: "['mp4a.40.2', 'opus']",
    to: "['opus', 'mp4a.40.2']",
    expect: 'a piece with sound falls back to Opus where AAC is refused, and keeps AAC wherever it is offered',
  },
  {
    why: 'the dOps fields keep the OpusHead byte order, so a decoder reads another rate and gain',
    file: 'core/film.js',
    from: 'u32(le.getUint32(12, true)), u16(le.getInt16(16, true))',
    to: 'u32(le.getUint32(12)), u16(le.getInt16(16))',
    expect: 'the dOps box is the OpusHead in big-endian with PreSkip 0, and the edit list skips the pre-skip',
  },
  {
    why: 'dOps repeats the pre-skip the edit list skips, so a reader that trims by both, as Chromium does, drops it twice',
    file: 'core/film.js',
    from: 'u8(head[9]), u16(0), u32(',
    to: 'u8(head[9]), u16(le.getUint16(10, true)), u32(',
    expect: 'the dOps box is the OpusHead in big-endian with PreSkip 0, and the edit list skips the pre-skip',
  },
  {
    why: 'the file check counts the pre-skip as heard sound',
    file: 'core/film.js',
    from: 'const heard = (a.duration - edit.mediaTime) / a.timescale;',
    to: 'const heard = a.duration / a.timescale;',
    expect: 'the film check hears an Opus soundtrack without its pre-skip',
  },
  {
    why: 'an Opus packet is taken for one frame whatever its TOC byte says',
    file: 'core/film.js',
    from: '  return frame * (code === 0 ? 1 : code === 3 ? packet[1] & 63 : 2);',
    to: '  return frame;',
    expect: 'an Opus packet lasts what its TOC byte says, in 48 kHz samples',
  },
  {
    why: 'the reader never opens the Opus sample entry, so a film with an Opus track reads as silent',
    file: 'core/film.js',
    from: "          if (t.codec === 'Opus') walk(entry + 36, entry + view.getUint32(entry));",
    to: '',
    expect: 'the film check hears an Opus soundtrack without its pre-skip',
  },
  {
    why: 'an Opus track without its dOps passes the file check, though no decoder can open it',
    file: 'core/film.js',
    from: '(opus && opus.version === 0)',
    to: "a.codec === 'Opus'",
    expect: 'the film check hears an Opus soundtrack without its pre-skip',
  },
  {
    why: 'the export writes no manifest, so a saved film cannot say what made it',
    file: 'core/film.js',
    from: '    audio: sound,\n    manifest,\n',
    to: '    audio: sound,\n',
    expect: 'an exported film names its piece, seed, parameters, frame grid and scale',
  },
  {
    why: 'the manifest says a looping film does not loop, so a replay puts its frames at other playheads',
    file: 'core/film.js',
    from: 'loop: !!piece.time.loop, scale }',
    to: 'loop: false, scale }',
    expect: 'an exported film names its piece, seed, parameters, frame grid and scale',
  },
  {
    why: 'the manifest records 1x for a 2x film, and a piece that draws finer detail at 2x replays differently',
    file: 'core/film.js',
    from: ', scale } };',
    to: ', scale: 1 } };',
    expect: 'an exported film names its piece, seed, parameters, frame grid and scale',
  },
  {
    why: 'the manifest is written a byte per character, so a name past Latin-1 comes back as another name',
    file: 'core/film.js',
    from: 'JSON.stringify(m).replace(',
    to: 'JSON.stringify(m).toString(',
    expect: 'a film carries its replay manifest in a user-data box, and no sample byte moves',
  },
  {
    why: 'the chunk offsets ignore the manifest box, so every sample is read from the wrong bytes',
    file: 'core/film.js',
    from: '  let at = ftyp.length + moov().length + 8;',
    to: '  let at = ftyp.length + moov().length - udta.length + 8;',
    expect: 'a film carries its replay manifest in a user-data box, and no sample byte moves',
  },
  {
    why: 'the reader never opens the user-data box, so every film reads as carrying no manifest',
    file: 'core/film.js',
    from: "'dinf', 'edts', 'udta']);",
    to: "'dinf', 'edts']);",
    expect: 'a film carries its replay manifest in a user-data box, and no sample byte moves',
  },
  {
    why: 'the reader takes any uuid box for the manifest, whoever wrote it',
    file: 'core/film.js',
    from: "kind === 'uuid' && size - head >= 16 && MANIFEST_TYPE.every((v, i) => bytes[b + i] === v)",
    to: "kind === 'uuid' && size - head >= 16",
    expect: 'the film check refuses a film whose manifest is missing or differs from the one the export drew with',
  },
  {
    why: 'the file check compares nothing, so a film naming another seed is saved',
    file: 'core/film.js',
    from: '  if (differs) {',
    to: '  if (false) {',
    expect: 'the film check refuses a film whose manifest is missing or differs from the one the export drew with',
  },
  {
    why: 'the movie counts in milliseconds again, so a film that is no whole number of them is rounded',
    file: 'core/film.js',
    from: 'const movieScale = video.timescale;',
    to: 'const movieScale = 1000;',
    expect: 'a film lasts its frames: the movie, each track header, and one soundtrack edit that skips the priming',
  },
  {
    why: "the soundtrack's header gives its packets' length, which runs past the film",
    file: 'core/film.js',
    from: 'const span = t.edit ? t.edit.duration : Math.round',
    to: 'const span = Math.round',
    expect: 'a film lasts its frames: the movie, each track header, and one soundtrack edit that skips the priming',
  },
  {
    why: "the edit is counted in the soundtrack's ticks instead of the movie's, so it plays twice the film",
    file: 'core/film.js',
    from: 'edit: { duration: length, mediaTime',
    to: 'edit: { duration: (length * 48000) / video.timescale, mediaTime',
    expect: 'a film lasts its frames: the movie, each track header, and one soundtrack edit that skips the priming',
  },
  {
    why: "the edit skips nothing, so a player that trims by the edit list plays an Opus film's pre-skip as sound",
    file: 'core/film.js',
    from: 'mediaTime: audio.priming || 0 },',
    to: 'mediaTime: 0 },',
    expect: 'a film lasts its frames: the movie, each track header, and one soundtrack edit that skips the priming',
  },
  {
    why: 'the reader never reads the edit list, so every soundtrack looks unedited',
    file: 'core/film.js',
    from: "      else if (kind === 'elst') {",
    to: '      else if (false) {',
    expect: 'a film lasts its frames: the movie, each track header, and one soundtrack edit that skips the priming',
  },
  {
    why: "the Opus encoder's pre-skip is lost on the way to the file, so the edit skips nothing",
    file: 'core/film.js',
    from: 'priming: description[10] | (description[11] << 8)',
    to: 'priming: 0',
    expect: 'a piece with sound falls back to Opus where AAC is refused, and keeps AAC wherever it is offered',
  },
  {
    why: "an AAC encoder's reported priming is ignored, so a player plays it as sound",
    file: 'core/film.js',
    from: 'priming: lead + Math.max(0, Math.round((-first * rate) / 1e6))',
    to: 'priming: lead',
    expect: 'an AAC soundtrack follows a 2112-sample silent lead, and its edit skips the lead and any priming the encoder reports',
  },
  {
    why: "an AAC soundtrack starts in the encoder's first frame, whose first ~500 samples no decoder rebuilds",
    file: 'core/film.js',
    from: 'const AAC_LEAD = 2112;',
    to: 'const AAC_LEAD = 0;',
    expect: 'an AAC soundtrack follows a 2112-sample silent lead, and its edit skips the lead and any priming the encoder reports',
  },
  {
    why: "the AAC lead is a whole number of packets, so Edge's video element starts the soundtrack's packet cold and loses its first 448 samples",
    file: 'core/film.js',
    from: 'const AAC_LEAD = 2112;',
    to: 'const AAC_LEAD = 2048;',
    expect: 'an AAC soundtrack follows a 2112-sample silent lead, and its edit skips the lead and any priming the encoder reports',
  },
  {
    why: 'the edit does not skip the AAC lead, so every player starts the soundtrack 44 ms late',
    file: 'core/film.js',
    from: 'priming: lead + Math.max(',
    to: 'priming: Math.max(',
    expect: 'an AAC soundtrack follows a 2112-sample silent lead, and its edit skips the lead and any priming the encoder reports',
  },
  {
    why: "the soundtrack is stamped from zero on top of the lead, so the encoder's timeline overlaps itself",
    file: 'core/film.js',
    from: 'timestamp: Math.round(((lead + at) * 1e6) / rate), data,',
    to: 'timestamp: Math.round((at * 1e6) / rate), data,',
    expect: 'an AAC soundtrack follows a 2112-sample silent lead, and its edit skips the lead and any priming the encoder reports',
  },
  {
    why: 'a soundtrack that fails lets the frames run on to the end of the film',
    file: 'core/film.js',
    from: '        if (soundFailure) throw soundFailure;\n',
    to: '',
    expect: 'a soundtrack that fails stops the frames and fails the export with its own message',
  },
  {
    why: 'the soundtrack is made before the frames again, so they wait for it',
    file: 'core/film.js',
    from: '  soundtrack.then(() => { soundPending = false; }',
    to: '  await soundtrack.catch(() => {});\n  soundtrack.then(() => { soundPending = false; }',
    expect: 'the frames draw while the soundtrack renders and encodes, and do not wait for it',
  },
  {
    why: "the frames never yield while the soundtrack is made, so its steps on the page's thread wait for the last frame",
    file: 'core/film.js',
    from: '        if (soundPending) await pause();\n',
    to: '',
    expect: 'the frames draw while the soundtrack renders and encodes, and do not wait for it',
  },
  {
    why: 'a browser that encodes neither soundtrack codec is not refused before the frames draw',
    file: 'core/film.js',
    from: '  if (piece.sound && !soundCodec) throw new Error(',
    to: '  if (false) throw new Error(',
    expect: 'a piece with sound gets a soundtrack exactly as long as its film, or no film at all',
  },
  {
    why: 'the file is written without waiting for the soundtrack',
    file: 'core/film.js',
    from: '  const { sound, level } = await soundtrack;',
    to: '  const { sound, level } = { sound: null, level: null };',
    expect: 'a piece with sound gets a soundtrack exactly as long as its film, or no film at all',
  },
  {
    why: 'an encoder route that returns frames short keeps its film, which the frame count then refuses whole',
    file: 'core/film.js',
    from: '      if (copy && chunks.length !== heads.length) return null;\n',
    to: '',
    expect: 'a film the encoder route returns frames short of is encoded again, converted, and keeps every frame',
  },
  {
    why: 'a frame-count refusal no longer names the route that ran',
    file: 'core/film.js',
    from: "      + (expected.route ? `, from the ${expected.route} route` : '')\n",
    to: '',
    expect: 'a film refused for its frame count names the route and the frames its encoder returned nothing for',
  },
  {
    why: 'a frame-count refusal no longer names the frames the encoder returned nothing for',
    file: 'core/film.js',
    from: '  const missing = heads.map((_, i) => stamp(i)).filter((t) => !returned.has(t));',
    to: '  const missing = [];',
    expect: 'a film refused for its frame count names the route and the frames its encoder returned nothing for',
  },
  {
    why: 'a pass hands back its film without its own times, so the report cannot time the pass that made it',
    file: 'core/film.js',
    from: '(x) => ({ ...x, timestamp: x.timestamp - shift })), drawMs, convertMs, waitMs };',
    to: '(x) => ({ ...x, timestamp: x.timestamp - shift })) };',
    expect: 'a film saved after the encoder route is discarded reports the times of the pass that made it',
  },
  {
    why: 'a probe the encoder returned nothing for decodes the last chunk it finds, a frame of the film',
    file: 'core/film.js',
    from: '      if (!chunks.length || chunks[chunks.length - 1].timestamp !== timestamp) return false;\n',
    to: '',
    expect: 'a probe the encoder returns nothing for fails the encoder route, and no frame is decoded in its place',
  },
  {
    why: 'the shared stand-in canvas reads nothing back, so every film that converts its frames draws nothing',
    file: 'tests/fake-media.js',
    from: '      getImageData(x, y, w, h) {\n        const px = pixels(), data = new Uint8ClampedArray(w * h * 4);\n'
      + '        for (let j = 0; j < h; j++) data.set(px.subarray(((y + j) * canvas.width + x) * 4, ((y + j) * canvas.width + x + w) * 4), j * w * 4);\n'
      + '        return { width: w, height: h, data };\n      },\n',
    to: '',
    expect: 'every frame reaches the encoder as BT.709 limited-range NV12, whatever the encoder reports',
  },
  {
    why: "the Opus stand-in forgets Edge's pre-skip packets, so the tests' soundtracks end before their edits",
    file: 'tests/fake-media.js',
    from: "this.held = config.codec === 'opus' ? 312 : 0;",
    to: 'this.held = 0;',
    expect: 'the audio stand-ins emit as many packets as the Edge encoders do',
  },
  {
    why: 'the file check lets a soundtrack end up to a packet before its edit, so its last samples go missing',
    file: 'core/film.js',
    from: 'const covered = (a.duration - edit.mediaTime) * movie.timescale >= edit.duration * a.timescale;',
    to: 'const covered = heard >= seconds - grain;',
    expect: 'the film check refuses a soundtrack that ends before its edit, however little',
  },
  {
    why: 'the file check lets the movie run past the film',
    file: 'core/film.js',
    from: '  if (!(Math.abs(movie.duration / movie.timescale - seconds) * movie.timescale <= 0.5)) {',
    to: '  if (false) {',
    expect: 'the film check refuses a movie, a track header or a soundtrack edit that disagrees with the film',
  },
  {
    why: 'the file check ignores the track headers, so a player reading them runs past the film',
    file: 'core/film.js',
    from: '  if (long) {',
    to: '  if (false) {',
    expect: 'the film check refuses a movie, a track header or a soundtrack edit that disagrees with the film',
  },
  {
    why: 'the file check stops asking for the soundtrack edit',
    file: 'core/film.js',
    from: '    if (!edit) {',
    to: '    if (false) {',
    expect: 'the film check refuses a movie, a track header or a soundtrack edit that disagrees with the film',
  },
  {
    why: "the file check lets the soundtrack's edit run past the film",
    file: 'core/film.js',
    from: '    if (edit.duration !== movie.duration) {',
    to: '    if (false) {',
    expect: 'the film check refuses a movie, a track header or a soundtrack edit that disagrees with the film',
  },
  {
    why: "the file check ignores what the edit skips, so a film that plays the priming or drops sound is saved",
    file: 'core/film.js',
    from: '    if (edit.mediaTime !== expected.priming) {',
    to: '    if (false) {',
    expect: 'the film check refuses a movie, a track header or a soundtrack edit that disagrees with the film',
  },
  {
    why: 'K-weighting loses its high shelf, so bright sound measures as quiet as dull',
    file: 'core/film.js',
    from: '  const Vh = 10 ** (3.999843853973347 / 20);',
    to: '  const Vh = 1;',
    expect: 'loudness follows BS.1770-4: K-weighting, 400 ms blocks, and gates of power at -70 LUFS and 10 LU down',
  },
  {
    why: 'loudness has no absolute gate, so near-silence counts as sound to be raised',
    file: 'core/film.js',
    from: '  const heard = blocks.filter((z) => lufs(z) > -70);',
    to: '  const heard = blocks.filter((z) => z > 0);',
    expect: 'loudness follows BS.1770-4: K-weighting, 400 ms blocks, and gates of power at -70 LUFS and 10 LU down',
  },
  {
    why: 'loudness has no relative gate, so quiet passages pull a loud film down',
    file: 'core/film.js',
    from: '  const floor = lufs(mean(heard)) - 10;',
    to: '  const floor = -70;',
    expect: 'loudness follows BS.1770-4: K-weighting, 400 ms blocks, and gates of power at -70 LUFS and 10 LU down',
  },
  {
    why: 'the gates average decibels instead of power',
    file: 'core/film.js',
    from: '  const mean = (zs) => zs.reduce((s, z) => s + z, 0) / zs.length;',
    to: '  const mean = (zs) => 10 ** (zs.reduce((s, z) => s + Math.log10(z), 0) / zs.length);',
    expect: 'loudness follows BS.1770-4: K-weighting, 400 ms blocks, and gates of power at -70 LUFS and 10 LU down',
  },
  {
    why: 'true peak reads only the samples, so a peak between them is missed',
    file: 'core/film.js',
    from: '      for (let p = 0; p < 4; p++) {',
    to: '      for (let p = 0; p < 1; p++) {',
    expect: 'true peak finds the peaks between samples, oversampled four times as BS.1770-4 Annex 2 filters them',
  },
  {
    why: 'the export gives a peaky soundtrack one gain, stopped at the ceiling, and it plays quiet',
    file: 'core/film.js',
    from: '  let gain = Math.min(want, room), limited = 0;\n  if (want > room) {',
    to: '  let gain = Math.min(want, room), limited = 0;\n  if (false) {',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'the limiter may cut peaks by any depth, so a lone click crushes the whole soundtrack to reach -14 LUFS',
    file: 'core/film.js',
    from: 'short: 3, depth: 12,',
    to: 'short: 3, depth: 40,',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'the limiter stops searching for the gain half a LU from the target',
    file: 'core/film.js',
    from: '      if (Math.abs(miss) <= 0.005 ||',
    to: '      if (Math.abs(miss) <= 0.5 ||',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'the limiter turns down only after a peak has passed, and a trim of the whole soundtrack catches the peak instead',
    file: 'core/film.js',
    from: '    const q = j - span + 1;',
    to: '    const q = j;',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'the limiter reads peaks from its last channel only, so the other passes the ceiling until a trim of the whole soundtrack',
    file: 'core/film.js',
    from: '      let peak = envelope[i - 11];',
    to: '      let peak = 0;',
    expect: 'the limiter meets every peak on both channels from the first sample, ahead of it, and lets go over 50 ms',
  },
  {
    why: 'before the first sample the limiter assumes no cut, so a hit on the first sample passes the ceiling until a trim',
    file: 'core/film.js',
    from: '  for (let k = 0, sum = attack * least[0], g = 1; k < n; k++) {\n    sum += least[k] - least[Math.max(0, k - attack)];',
    to: '  for (let k = 0, sum = attack, g = 1; k < n; k++) {\n    sum += least[k] - (k >= attack ? least[k - attack] : 1);',
    expect: 'the limiter meets every peak on both channels from the first sample, ahead of it, and lets go over 50 ms',
  },
  {
    why: 'the limiter lets go as fast as it turned down, a 5 ms release that distorts a bass',
    file: 'core/film.js',
    from: '    g = Math.min(sum / attack, 1 - (1 - g) * back);',
    to: '    g = sum / attack;',
    expect: 'the limiter meets every peak on both channels from the first sample, ahead of it, and lets go over 50 ms',
  },
  {
    why: 'the limiter releases over another time than it states',
    file: 'core/film.js',
    from: 'attack: 0.005, release: 0.05 };',
    to: 'attack: 0.005, release: 0.1 };',
    expect: 'the limiter meets every peak on both channels from the first sample, ahead of it, and lets go over 50 ms',
  },
  {
    why: 'the limiter looks further ahead than it states, turning down before 5 ms and 12 samples ahead of a peak',
    file: 'core/film.js',
    from: 'attack: 0.005, release: 0.05 };',
    to: 'attack: 0.01, release: 0.05 };',
    expect: 'the limiter meets every peak on both channels from the first sample, ahead of it, and lets go over 50 ms',
  },
  {
    why: 'an AAC soundtrack is limited under -1 dBTP, and AAC lifts limited peaks past -1 dBTP once decoded',
    file: 'core/film.js',
    from: 'ceiling: { mp4a: -2, Opus: -2 }',
    to: 'ceiling: { mp4a: -1, Opus: -2 }',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'an Opus soundtrack is limited under -1.2 dBTP, and Opus lifts limited peaks past -1 dBTP once decoded',
    file: 'core/film.js',
    from: 'ceiling: { mp4a: -2, Opus: -2 }',
    to: 'ceiling: { mp4a: -2, Opus: -1.2 }',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'a codec by another name is levelled with no ceiling at all',
    file: 'core/film.js',
    from: "  if (typeof ceiling !== 'number') throw",
    to: '  if (false) throw',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'a film far under -14 LUFS does not say how far',
    file: 'core/film.js',
    from: '    ...(short > LOUDNESS.short && { short: round2(short) }),\n',
    to: '',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'a film within 3 LU of -14 LUFS reports a shortfall',
    file: 'core/film.js',
    from: 'short > LOUDNESS.short &&',
    to: 'short > 0 &&',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'the film reports a gain it never applies to the soundtrack it encodes',
    file: 'core/film.js',
    from: '    for (let i = 0; i < x.length; i++) x[i] *= scale;',
    to: '    for (let i = 0; i < x.length; i++) x[i] *= 1;',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'a soundtrack of samples that are not finite numbers is encoded instead of refused',
    file: 'core/film.js',
    from: '    if (!buffer.getChannelData(c).every(Number.isFinite)) {',
    to: '    if (false) {',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'a WebM export too slow for real time is blamed on lost pictures again',
    file: 'tools/build-page.js',
    from: '  const slow = pace && pace.worstLagMs > budget',
    to: '  const slow = false',
    expect: 'a film too slow to record in real time says so, and names the export that can',
  },
  {
    why: 'the page offers an MP4 film for a still',
    file: 'tools/build-page.js',
    from: '  Array.prototype.forEach.call(filmButtons, function (b) { b.disabled = !ready || !current.time || filmBusy; });',
    to: '  Array.prototype.forEach.call(filmButtons, function (b) { b.disabled = !ready || filmBusy; });',
    expect: 'the MP4 film is refused by name without an encoder, and a still offers none',
  },
  {
    why: 'an SVG saved from the page cannot name the recipe that made it, though the same SVG from the API can',
    file: 'tools/build-page.js',
    from: '  g.setManifest(recipe());',
    to: '',
    expect: 'an SVG saved from the page names the recipe manifest() names, in the bytes renderVector writes',
  },
  {
    why: 'the PNG manifest reader looks for its nulls past the chunk, and on a cut file never stops',
    file: 'tools/build-page.js',
    from: "      if (at >= end) throw new Error('the artifex-manifest chunk ends before its text');",
    to: '',
    expect: 'a PNG cut short inside its manifest chunk, or a chunk without its text, is refused by name',
  },
  {
    why: 'the manifest chunk\'s CRC is left uncomplemented, so an image tool reports the PNG as corrupt',
    file: 'tools/build-page.js',
    from: '  return ~crc >>> 0;',
    to: '  return crc >>> 0;',
    expect: 'a PNG carries its recipe in one iTXt chunk before IEND, and every other byte as encoded',
  },
  {
    why: 'a PNG saved from the page is saved as encoded, so a print master cannot name its recipe',
    file: 'tools/build-page.js',
    from: "        save(new Blob([pngWithManifest(new Uint8Array(buf), manifest)], { type: 'image/png' }), filename);",
    to: "        save(new Blob([new Uint8Array(buf)], { type: 'image/png' }), filename);",
    expect: 'a PNG saved from the page names its recipe and the scale it was drawn at',
  },
  {
    why: 'a PNG master\'s recipe leaves out its scale, and a piece may draw finer detail at a higher one',
    file: 'tools/build-page.js',
    from: '    var manifest = Object.assign(recipe(), { scale: k });',
    to: '    var manifest = recipe();',
    expect: 'a PNG saved from the page names its recipe and the scale it was drawn at',
  },
  {
    why: 'the WebM export hands the recorder its alpha plane, and Edge scales that film on another path',
    file: 'tools/build-page.js',
    from: "    var f = new VideoFrame(copy, { timestamp: Math.round((i * 1000000) / hz), alpha: 'discard' });",
    to: '    var f = new VideoFrame(copy, { timestamp: Math.round((i * 1000000) / hz) });',
    expect: 'the WebM export records frames without alpha and saves the film with its length',
  },
  {
    why: 'the WebM recorder takes frames from the canvas the piece draws on, so a piece that reads it back switches the film to full range mid-way',
    file: 'tools/build-page.js',
    from: "    var f = new VideoFrame(copy, { timestamp: Math.round((i * 1000000) / hz), alpha: 'discard' });",
    to: "    var f = new VideoFrame(off, { timestamp: Math.round((i * 1000000) / hz), alpha: 'discard' });",
    expect: 'the WebM export records a copy of each frame, on a canvas no piece reads back',
  },
  {
    why: 'the WebM export saves the film as recorded, so a player shows it as 0.001 s long',
    file: 'tools/build-page.js',
    from: "  var blob = new Blob([webmWithManifest(webmWithDuration(bytes, heads.length / hz), manifest)], { type: 'video/webm' });",
    to: "  var blob = new Blob([webmWithManifest(bytes, manifest)], { type: 'video/webm' });",
    expect: 'the WebM export records frames without alpha and saves the film with its length',
  },
  {
    why: 'an Opus film is saved without the warning, and its author learns only in a player that plays it silent',
    file: 'tools/build-page.js',
    from: "    + (codec === 'Opus' ? ' This browser encodes no AAC, so the soundtrack is Opus: play the film where Opus in MP4 is supported, or it plays silent.' : '');",
    to: "    + '';",
    expect: 'the MP4 note names the soundtrack codec and the colour route, and warns about Opus',
  },
  {
    why: 'the WebM export saves the film without its recipe, so a fallback film cannot say what made it',
    file: 'tools/build-page.js',
    from: "  var blob = new Blob([webmWithManifest(webmWithDuration(bytes, heads.length / hz), manifest)], { type: 'video/webm' });",
    to: "  var blob = new Blob([webmWithDuration(bytes, heads.length / hz)], { type: 'video/webm' });",
    expect: 'the WebM export names the recipe an MP4 of the same film names',
  },
  {
    why: 'every Tags part claims one byte more than it holds, so a reader runs into the next part',
    file: 'tools/build-page.js',
    from: '    for (let i = 7, v = body.length; i > 0; i--, v = Math.floor(v / 256)) size[i] = v % 256;',
    to: '    for (let i = 7, v = body.length + 1; i > 0; i--, v = Math.floor(v / 256)) size[i] = v % 256;',
    expect: 'a WebM carries its recipe in one Tags element before the first Cluster, and every other byte as saved',
  },
  {
    why: 'a Segment of known size keeps its old size after the Tags go in, so a reader stops short of the last Cluster',
    file: 'tools/build-page.js',
    from: '  if (segment && !segment.unknown) ebmlResize(src, segment, segment.size + total);',
    to: '',
    expect: 'a WebM carries its recipe in one Tags element before the first Cluster, and every other byte as saved',
  },
  {
    why: 'stored positions keep their recorded values, so the Cues Edge writes name the Tags where the first Cluster was',
    file: 'tools/build-page.js',
    from: '        let v = move(uint(c.body, c.size)), n = c.size;',
    to: '        let v = uint(c.body, c.size), n = c.size;',
    expect: 'a WebM insertion moves every stored position with the element it names',
  },
  {
    why: 'a moved position keeps its field width, so its high byte is lost and it points into the Tags',
    file: 'tools/build-page.js',
    from: '        while (v >= 256 ** n) n++;',
    to: '',
    expect: 'a WebM insertion moves every stored position with the element it names',
  },
  {
    why: 'a SeekHead or Cues that grows moves nothing after it, so every position past it falls short',
    file: 'tools/build-page.js',
    from: '  const move = (P) => P + (P >= at - base ? added.length : 0) + index.reduce((sum, e, i) => sum + (e.at - base < P ? grown[i] : 0), 0);',
    to: '  const move = (P) => P + (P >= at - base ? added.length : 0);',
    expect: 'a WebM insertion moves every stored position with the element it names',
  },
  {
    why: 'a CueCodecState, CueReference or misplaced CRC-32 inside an index is copied as it was, and goes stale',
    file: 'tools/build-page.js',
    from: '      if (c.id in REFUSED) refuse(c.id);',
    to: '',
    expect: 'a WebM that stores a position the insertion cannot move is refused by name',
  },
  {
    why: 'a Cluster that stores its own position is saved with it, pointing short of where the Cluster now sits',
    file: 'tools/build-page.js',
    from: '    if (e.id === 0xA7) refuse(e.id);',
    to: '',
    expect: 'a WebM that stores a position the insertion cannot move is refused by name',
  },
  {
    why: 'the page leaves Info\'s CRC-32 as recorded after writing the Duration, so a checking reader finds Info corrupt',
    file: 'tools/build-page.js',
    from: '        if (c.id === CRC && c.size === 4) new DataView(out.buffer, out.byteOffset).setUint32(c.body, crc32(out.subarray(c.body + 4, e.body + e.size)), true);',
    to: '',
    expect: 'a WebM keeps every CRC-32 matching its element when the page writes its length',
  },
  {
    why: 'Info\'s CRC-32 is stored big-endian, where EBML stores it little-endian',
    file: 'tools/build-page.js',
    from: '        if (c.id === CRC && c.size === 4) new DataView(out.buffer, out.byteOffset).setUint32(c.body, crc32(out.subarray(c.body + 4, e.body + e.size)), true);',
    to: '        if (c.id === CRC && c.size === 4) new DataView(out.buffer, out.byteOffset).setUint32(c.body, crc32(out.subarray(c.body + 4, e.body + e.size)), false);',
    expect: 'a WebM keeps every CRC-32 matching its element when the page writes its length',
  },
  {
    why: 'writing the Duration keeps a CRC-32 over the whole Segment as recorded, and it goes stale',
    file: 'tools/build-page.js',
    from: "        if (ebmlHead(out, e.body).id === CRC) throw new Error('the recorded WebM carries a CRC-32 over its Segment, which writing its length would leave stale');",
    to: '',
    expect: 'a WebM keeps every CRC-32 matching its element when the page writes its length',
  },
  {
    why: 'an insertion keeps a CRC-32 over the whole Segment as recorded, and it goes stale',
    file: 'tools/build-page.js',
    from: '      if (ebmlHead(bytes, e.body).id === 0xBF) refuse(0xBF);',
    to: '',
    expect: 'a WebM keeps every CRC-32 matching its element when the page writes its length',
  },
  {
    why: 'a rebuilt SeekHead or Cues keeps the CRC-32 it was recorded with, so a checking reader finds it corrupt',
    file: 'tools/build-page.js',
    from: '      body = [0xBF, 0x84, sum & 255, (sum >>> 8) & 255, (sum >>> 16) & 255, sum >>> 24, ...body];',
    to: '      body = [...bytes.subarray(e.body, e.body + 6), ...body];',
    expect: 'a WebM SeekHead or Cues that opens with a CRC-32 keeps it matching through the page\'s edits',
  },
  {
    why: 'a rebuilt SeekHead or Cues loses its CRC-32',
    file: 'tools/build-page.js',
    from: '      if (q === e.body && c.id === 0xBF && c.size === 4) { summed = true; q = c.body + c.size; continue; }',
    to: '      if (q === e.body && c.id === 0xBF && c.size === 4) { q = c.body + c.size; continue; }',
    expect: 'a WebM SeekHead or Cues that opens with a CRC-32 keeps it matching through the page\'s edits',
  },
  {
    why: 'a finalized recording\'s SeekHead leaves the Tags out, so a reader that finds elements through it misses the recipe',
    file: 'tools/build-page.js',
    from: '    return webmInsert(bytes, p, tags, null, true);',
    to: '    return webmInsert(bytes, p, tags, null);',
    expect: 'a WebM SeekHead lists the Tags the page adds, and a reader that follows it finds the recipe',
  },
  {
    why: 'the Seek entry for the Tags points past them, at the first Cluster',
    file: 'tools/build-page.js',
    from: '      let v = move(at - base) - added.length;',
    to: '      let v = move(at - base);',
    expect: 'a WebM SeekHead lists the Tags the page adds, and a reader that follows it finds the recipe',
  },
  {
    why: 'the page offers the WebM recorder where the MP4 film encodes',
    file: 'tools/build-page.js',
    from: "      document.getElementById('webm').hidden = choice.format !== 'webm';",
    to: "      document.getElementById('webm').hidden = false;",
    expect: 'a browser that encodes the film H.264 offers only the MP4 export',
  },
  {
    why: 'the WebM fallback never appears, so a browser without H.264 offers no film it can make',
    file: 'tools/build-page.js',
    from: "  if (!encodesH264) return { format: 'webm', reason: 'h264' };",
    to: "  if (!encodesH264) return { format: 'mp4', reason: null };",
    expect: 'where H.264 cannot encode the film, the page offers the WebM recorder instead',
  },
  {
    why: 'an H.264 answer about the previous piece changes the film offered for the current one',
    file: 'tools/build-page.js',
    from: '    if (p === current) {',
    to: '    if (true) {',
    expect: 'an unanswered H.264 question blocks nothing, and a late answer stays with its piece',
  },
  {
    why: 'a piece with sound is offered the MP4 film where no soundtrack codec encodes, so it gets no film at all',
    file: 'tools/build-page.js',
    from: '    voiced = aacOrOpus;',
    to: '    voiced = true;',
    expect: 'where neither AAC nor Opus encodes, a piece with sound is offered a silent WebM',
  },
  {
    why: 'a piece without sound loses its MP4 film because the browser encodes no soundtrack codec',
    file: 'tools/build-page.js',
    from: '  if (p.time && p.sound) {',
    to: '  if (p.time) {',
    expect: 'a piece without sound keeps the MP4 film where neither AAC nor Opus encodes',
  },
  {
    why: 'the page tells a script the soundtrack is to blame where H.264 is',
    file: 'tools/build-page.js',
    from: "  if (!encodesH264) return { format: 'webm', reason: 'h264' };",
    to: "  if (!encodesH264) return { format: 'webm', reason: 'soundtrack' };",
    expect: 'the page tells a script why it offers WebM, from the decision its note is written from',
  },
  {
    why: 'pausing the transport leaves its soundtrack playing',
    file: 'tools/build-page.js',
    from: '  cancelAnimationFrame(raf);\n  silence();',
    to: '  cancelAnimationFrame(raf);',
    expect: 'playing a piece with sound plays its soundtrack from the playhead, and every transport change stops it',
  },
  {
    why: 'a soundtrack rendered after the transport stopped starts playing anyway',
    file: 'tools/build-page.js',
    from: '    if (!playing || transport !== transportRevision || solved !== s || soundtrack !== entry) return;',
    to: '    if (false) return;',
    expect: 'playing a piece with sound plays its soundtrack from the playhead, and every transport change stops it',
  },
  {
    why: 'the transport soundtrack starts from its beginning wherever the playhead is',
    file: 'tools/build-page.js',
    from: '    v.start(0, Math.min(at, buffer.duration));',
    to: '    v.start(0, 0);',
    expect: 'playing a piece with sound plays its soundtrack from the playhead, and every transport change stops it',
  },
  {
    why: 'the transport wraps and its soundtrack does not start again',
    file: 'tools/build-page.js',
    from: '    if (laps > lap) { lap = laps; playSound(transport); }',
    to: '    if (laps > lap) { lap = laps; }',
    expect: 'playing a piece with sound plays its soundtrack from the playhead, and every transport change stops it',
  },
  {
    why: 'the transport counts a lap as soon as it starts, and starts its soundtrack twice',
    file: 'tools/build-page.js',
    from: '    var laps = Math.floor((now - t0) / dur);',
    to: '    var laps = Math.ceil((now - t0) / dur);',
    expect: 'playing a piece with sound plays its soundtrack from the playhead, and every transport change stops it',
  },
  {
    why: 'the transport laps at the declared duration, past the frame grid and the soundtrack',
    file: 'tools/build-page.js',
    from: 'function lapMs(p) { return (render.playheads(p).length / p.time.hz) * 1000; }',
    to: 'function lapMs(p) { return p.time.duration * 1000; }',
    expect: 'a transport lap lasts the frame grid, and a frame stamped before the click reads playhead 0',
  },
  {
    why: 'a frame stamped before the play click gives the transport a negative playhead',
    file: 'tools/build-page.js',
    from: '    t = Math.max(0, (now - t0) % dur) / dur;',
    to: '    t = ((now - t0) % dur) / dur;',
    expect: 'a transport lap lasts the frame grid, and a frame stamped before the click reads playhead 0',
  },
  {
    why: 'a new solve while playing goes silent',
    file: 'tools/build-page.js',
    from: '  if (playing) playSound(transportRevision);',
    to: '',
    expect: 'playing a piece with sound plays its soundtrack from the playhead, and every transport change stops it',
  },
  {
    why: 'the play click makes an audio context for a piece without sound',
    file: 'tools/build-page.js',
    from: "  if (current.sound && typeof AudioContext === 'function') {",
    to: "  if (typeof AudioContext === 'function') {",
    expect: 'playing a piece with sound plays its soundtrack from the playhead, and every transport change stops it',
  },
  {
    why: 'the readout melody follows the seed instead of the data',
    file: 'examples/readout.js',
    from: '      note(at, ROOT_NOTE + DEGREES[c.digit],',
    to: '      note(at, ROOT_NOTE + DEGREES[(c.digit + s.seed) % 10],',
    expect: 'readout: the soundtrack reads the data, and the seed only chooses its voice',
  },
  {
    why: 'a zero-length span never opens, so a change timed for one instant never happens',
    file: 'core/time.js',
    from: '  if (a === b) return x < a ? 0 : 1;',
    to: '  if (a === b) return 0;',
    expect: 'a zero-length span is a CUT: nothing before it, everything from it on',
  },
  {
    why: 'rates extrapolate outside their window, so a finished move keeps travelling',
    file: 'core/time.js',
    from: 'const unit = (f) => (x) => (x <= 0 ? 0 : x >= 1 ? 1 : f(x));',
    to: 'const unit = (f) => f;',
    expect: 'every rate starts at 0 and arrives at 1, exactly, and holds outside its window',
  },
  {
    why: 'the in-out curve accelerates at half its rate and then jumps at the midpoint',
    file: 'core/time.js',
    from: '  inOut: unit((u) => { if (u < 0.5) return 4 * u * u * u; const v = 1 - u; return 1 - 4 * v * v * v; }),',
    to: '  inOut: unit((u) => { if (u < 0.5) return 2 * u * u * u; const v = 1 - u; return 1 - 4 * v * v * v; }),',
    expect: 'the rate curves keep their named shapes',
  },
  {
    why: 'the shared rate table can be reassigned, so one piece bends the curves of the next',
    file: 'core/time.js',
    from: 'const ease = Object.freeze({',
    to: 'const ease = ({',
    expect: "the rate table is frozen, so one piece cannot bend another piece's curves",
  },
  {
    why: 'a cut lands on the frame before its time instead of the nearest one',
    file: 'core/time.js',
    from: '    const end = Math.round(elapsed * timeline.hz);',
    to: '    const end = Math.floor(elapsed * timeline.hz);',
    expect: 'shots put every cut on the nearest whole frame of the timeline',
  },
  {
    why: 'the frame at a cut still shows the outgoing shot',
    file: 'core/time.js',
    from: '    if (list[mid].start <= frame) lo = mid;',
    to: '    if (list[mid].start < frame) lo = mid;',
    expect: 'THE FRAME AT A CUT BELONGS TO THE INCOMING SHOT, found by comparing integers',
  },
  {
    why: 'shotAt takes the unresolved seconds list and answers its first shot for every frame',
    file: 'core/time.js',
    from: '  if (!Array.isArray(list) || list.length === 0 || !Number.isInteger(list[0].start)) {',
    to: '  if (!Array.isArray(list) || list.length === 0) {',
    expect: 'THE FRAME AT A CUT BELONGS TO THE INCOMING SHOT, found by comparing integers',
  },
  {
    why: 'a shot list that ends before or after its timeline is accepted',
    file: 'core/time.js',
    from: '  if (start !== timeline.frames) {',
    to: '  if (false) {',
    expect: 'shots must fill their timeline, every shot must hold a frame, and a still has none',
  },
  {
    why: 'a spring moves before its cue and through its delay',
    file: 'core/time.js',
    from: '    return s <= delay ? 0 : at(s - delay);',
    to: '    return at(s - delay);',
    expect: 'a spring is 0 before its cue and through its delay, then leaves from rest',
  },
  {
    why: 'an under-damped spring loses its velocity term and rings with the wrong shape',
    file: 'core/time.js',
    from: '    out[0] = e * (c + s * n); out[1] = e * n; out[2] = -e * w * w * n; out[3] = e * (c - s * n);',
    to: '    out[0] = e * (c + n); out[1] = e * n; out[2] = -e * w * w * n; out[3] = e * (c - s * n);',
    expect: 'damping picks the spring\'s shape: under-damped rings past its mark, critical and over-damped never pass it',
  },
  {
    why: 'settle brackets the swing after the last one that leaves 0.1%, so it answers too late',
    file: 'core/time.js',
    from: '    const swing = Math.floor(Math.log(1 / SETTLE) * d / (z * w * Math.PI));',
    to: '    const swing = Math.ceil(Math.log(1 / SETTLE) * d / (z * w * Math.PI));',
    expect: 'settle is the time from which a spring stays within 0.1% of its mark',
  },
  {
    why: 'a very late time meets a cosine of an overflowed angle and the spring answers NaN',
    file: 'core/time.js',
    from: '  if (!(Math.abs(out[0]) + Math.abs(out[1]) + Math.abs(out[3]) > 0)) out.fill(0);',
    to: '',
    expect: 'a spring holds exactly 1 long after its cue, however large the time',
  },
  {
    why: 'a spring with no damping is accepted and never settles',
    file: 'core/time.js',
    from: '  if (!Number.isFinite(damping) || damping <= 0) {',
    to: '  if (!Number.isFinite(damping)) {',
    expect: 'spring and follow refuse invalid inputs by name',
  },
  {
    why: 'a follower feels no drag, so it keeps pace with a moving driver instead of trailing it',
    file: 'core/time.js',
    from: '      const lag = -2 * z * slope / w;',
    to: '      const lag = 0;',
    expect: 'follow trails a moving driver, passes it when the driver stops, and settles on it',
  },
  {
    why: 'a follower read between its steps carries the spring a whole step',
    file: 'core/time.js',
    from: '    if (r > 0) carry(w, z, r, rest);',
    to: '    if (r > 0) carry(w, z, h, rest);',
    expect: 'follow matches an independent integration of the same spring at any time asked',
  },
  {
    why: 'the readout rest shows an empty grid instead of the finished reading',
    file: 'examples/readout.js',
    from: "  const u = shot.name === 'read' ? span(shot.start, shot.end - 1, frame) : 1;",
    to: "  const u = shot.name === 'read' ? span(shot.start, shot.end - 1, frame) : 0;",
    expect: 'readout: the reading keeps its pace, then rests on the finished reading',
  },
  {
    why: 'the readout sound finds each digit one frame after the picture shows it',
    file: 'examples/readout.js',
    from: '      while (frame < timeline.frames && Math.floor((scanAt(s, film, frame) - c.k) * 2.4) < 1) frame++;',
    to: '      while (frame < timeline.frames && Math.floor((scanAt(s, film, Math.max(0, frame - 1)) - c.k) * 2.4) < 1) frame++;',
    expect: 'readout: every digit is heard on the frame that first shows it',
  },
  // The runner's own patch texts are split so each matches its code once, not this list too.
  {
    why: 'a failed control prints only test titles, not what the assertion saw',
    file: 'tests/negative.js',
    from: "    const detail = (result.diagnostics?.[i] || '')" + '.slice(0, 2000);',
    to: "    const detail = '';",
    expect: 'failed control exits 2, prints its failing assertion and removes only its owned temporary directory',
  },
  {
    why: 'teardown accepts a suite process that still runs after the kill',
    file: 'tests/negative.js',
    from: 'resolve(new Error(`owned tree ' + 'termination left',
    to: 'resolve(null && new Error(`owned tree termination left',
    expect: 'owned teardown is judged by its own process, never by the kill command',
  },
  {
    why: 'the settle detune glides on a schedule from where each node started, not from where it is',
    file: 'examples/settle.js',
    from: '        const lift = at(s, LAST, i)[1] - y;',
    to: '        const lift = (at(s, LAST, i)[1] - at(s, 0, i)[1]) * (1 - k / LAST);',
    expect: 'settle: the soundtrack follows the system frame by frame, and comes to rest with it',
  },
  {
    why: 'the settle level fades on the clock instead of following the energy trace',
    file: 'examples/settle.js',
    from: '      const heard = Math.max(0, Math.log(s.energy[k] / STILL)) / Math.log(TEMP0 / STILL);',
    to: '      const heard = k === 0 ? 0 : 1 - k / LAST;',
    expect: 'settle: the soundtrack follows the system frame by frame, and comes to rest with it',
  },
  {
    why: 'the settle voices read the next frame\'s snapshot, one ahead of the picture',
    file: 'examples/settle.js',
    from: '        const [x, y] = at(s, k, i);',
    to: '        const [x, y] = at(s, Math.min(LAST, k + 1), i);',
    expect: 'settle: the soundtrack follows the system frame by frame, and comes to rest with it',
  },
  {
    why: 'settle spreads its frames over one snapshot more than it draws, so frame 72 skips one',
    file: 'examples/settle.js',
    from: '  const o = (frame * s.nodes.length + i) * 2;',
    to: '  const o = (Math.min(LAST, Math.round((frame * FRAMES) / LAST)) * s.nodes.length + i) * 2;',
    expect: 'settle: frame k draws the snapshot stored for frame k, so each is drawn once',
  },
  {
    why: 'the seed reaches settle\'s graph, so a re-roll counts a node\'s edges on another node',
    file: 'examples/settle.js',
    from: '      for (const [a, b] of EDGES) { s.nodes[a].deg++; s.nodes[b].deg++; }',
    to: '      for (const [a, b] of EDGES) { s.nodes[(a + s.seed) % n].deg++; s.nodes[b].deg++; }',
    expect: 'settle: the seed moves where the graph starts, never what it connects',
  },
  {
    why: 'settle\'s start ignores the seed, so every re-roll springs from one scatter',
    file: 'examples/settle.js',
    from: '      const R = rng(s.seed);',
    to: '      const R = (...key) => rng(key[0] === \'start\' ? 1 : s.seed)(...key);',
    expect: 'settle: the seed moves where the graph starts, never what it connects',
  },
  {
    why: 'the audio fake keeps no connections, so no test can follow a node to the speakers',
    file: 'tests/fake-media.js',
    from: '    n.connect = (target) => { n.to.push(target); return target.kind === \'param\' ? undefined : target; };',
    to: '    n.connect = (target) => (target.kind === \'param\' ? undefined : target);',
    expect: 'a soundtrack of seeded noise renders in the audio fake, and its record reaches every node',
  },
  {
    why: 'the audio fake has no buffer source, so a piece that plays seeded noise fails its tests',
    file: 'tests/fake-media.js',
    from: '    createBufferSource() {',
    to: '    createNoiseSource() {',
    expect: 'a soundtrack of seeded noise renders in the audio fake, and its record reaches every node',
  },
  {
    why: 'the audio fake leaves gain nodes out of its record',
    file: 'tests/fake-media.js',
    from: '    if (kind !== \'destination\') record.nodes.push(n);',
    to: '    if (kind !== \'destination\' && kind !== \'gain\') record.nodes.push(n);',
    expect: 'a soundtrack of seeded noise renders in the audio fake, and its record reaches every node',
  },
  {
    why: 'the settle soundtrack counts each degree up as it reads it, so a second render plays another chord',
    file: 'examples/settle.js',
    from: '    const top = Math.max(...s.nodes.map((nd) => nd.deg));',
    to: '    const top = Math.max(...s.nodes.map((nd) => nd.deg++));',
    expect: 'every soundtrack builds the same graph each time it renders one solved state',
  },
  {
    why: 'the settle bass follows its node off-centre like every other voice',
    file: 'examples/settle.js',
    from: '    const reach = s.nodes.map((nd) => WIDTH * Math.max(0, Math.log2((top + 1 - nd.deg) / 2)) / Math.log2(top / 2));',
    to: '    const reach = s.nodes.map(() => WIDTH);',
    expect: 'settle: the soundtrack follows the system frame by frame, and comes to rest with it',
  },
  {
    why: 'sumInto lets three voices into one input, which Edge adds in an order that changes between renders',
    file: 'core/sound.js',
    from: '  if (nodes.length > 2) {',
    to: '  if (nodes.length > 3) {',
    expect: 'sumInto reaches one input with every voice once, through unity gains that each take at most two',
  },
  {
    why: 'sumInto keeps only the first of a pair, so a voice is never heard',
    file: 'core/sound.js',
    from: '      if (part.length === 1) return part[0];',
    to: '      if (part.length <= 2) return part[0];',
    expect: 'sumInto reaches one input with every voice once, through unity gains that each take at most two',
  },
  {
    why: 'the browser check lets two renders of a soundtrack differ in their last bits again',
    file: 'tools/check-browser.js',
    from: '      if (xs[i] !== ys[i]) return',
    to: '      if (Math.abs(x[i] - y[i]) > 1e-6) return',
    expect: 'two renders of a soundtrack match only when every sample holds the same bits',
  },
  {
    why: 'readout connects every note to one gain again, so Edge adds them in a changing order',
    file: 'examples/readout.js',
    from: '      notes.push(place);',
    to: '      place.connect(out);',
    expect: 'no node or param in an example soundtrack takes more than two inputs',
  },
  {
    why: 'settle connects every voice to its bus again, so Edge adds them in a changing order',
    file: 'examples/settle.js',
    from: '    sumInto(ctx, voices.map((v) => v.place), bus);',
    to: '    for (const v of voices) v.place.connect(bus);',
    expect: 'no node or param in an example soundtrack takes more than two inputs',
  },
  {
    why: 'cues connects every note to one gain again, so Edge adds them in a changing order',
    file: 'examples/cues.js',
    from: '      notes.push(place);',
    to: '      place.connect(out);',
    expect: 'no node or param in an example soundtrack takes more than two inputs',
  },
  {
    why: 'a report-only retry replaces the infrastructure verdict it was meant to explain',
    file: 'tests/negative.js',
    from: '    verdict, ' + 'retry,',
    to: '    verdict: retry, retry,',
    expect: 'an infrastructure result keeps its streams and stays infrastructure after one report-only retry',
  },
  {
    why: 'an infrastructure result keeps no TAP',
    file: 'tests/negative.js',
    from: "  fs.writeFileSync(path.join(dir, 'stdout.tap')" + ', result.stdout);',
    to: '',
    expect: 'an infrastructure result keeps its streams and stays infrastructure after one report-only retry',
  },
  {
    why: 'the browser stop accepts an owned Edge that never exited',
    file: 'tools/check-browser.js',
    from: '  if (!stopped) throw',
    to: '  if (false) throw',
    expect: 'browser stop waits for the owned Edge to exit and fails while it keeps running',
  },
  {
    why: 'a finished browser stop holds the command open until its bound',
    file: 'tools/check-browser.js',
    from: '  bound.abort();',
    to: '',
    expect: 'browser stop waits for the owned Edge to exit and fails while it keeps running',
  },
  {
    why: 'the browser profile removal gives up at the first busy file',
    file: 'tools/check-browser.js',
    from: "      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || Date.now() >= deadline) throw error;",
    to: '      throw error;',
    expect: 'browser profile removal retries a busy owned profile and refuses anything else',
  },
  {
    why: 'the browser profile removal accepts a path nested under an owned profile name',
    file: 'tools/check-browser.js',
    from: "  if (!/^artifex-browser-[^/\\\\]+$/.test(relative)) throw",
    to: '  if (!/^artifex-browser-/.test(relative)) throw',
    expect: 'browser profile removal retries a busy owned profile and refuses anything else',
  },
  {
    why: 'a browser run whose checks passed loses its report when only cleanup fails',
    file: 'tools/check-browser.js',
    from: 'catch (error) { failure = error; report = error.report; }',
    to: 'catch (error) { failure = error; }',
    expect: 'a run whose checks passed prints its report before a cleanup-only failure',
  },
  {
    why: 'a killed suite writes its fixtures to the system temporary directory instead of its copy',
    file: 'tests/negative.js',
    from: '  if (fs.existsSync(temp)) env.TEMP = ' + 'env.TMP = env.TMPDIR = temp;',
    to: '',
    expect: 'timed-out control stops its actual process tree, keeps its evidence and preserves unrelated temporary work',
  },
  {
    why: 'a new run never sweeps the copies of stopped runs',
    file: 'tests/negative.js',
    from: '  await sweepStale' + 'Runs();',
    to: '',
    expect: 'a new run removes the copies of stopped runs and keeps their evidence and everything else',
  },
  {
    why: 'the sweep removes the copies of a run that is still going',
    file: 'tests/negative.js',
    from: '|| owner === process.pid || ' + 'running(owner)) continue;',
    to: '|| owner === process.pid) continue;',
    expect: 'a new run removes the copies of stopped runs and keeps their evidence and everything else',
  },
  {
    why: 'the sweep removes the evidence a stopped run kept for its report',
    file: 'tests/negative.js',
    from: "if (entry !== 'infrastructure') await removeCopy(path.join(root" + ', entry), 0)',
    to: 'await removeCopy(path.join(root, entry), 0)',
    expect: 'a new run removes the copies of stopped runs and keeps their evidence and everything else',
  },
  {
    why: 'teardown misses a suite process that exits during the grace period',
    file: 'tests/negative.js',
    from: "      child.once('exit', " + 'exited);',
    to: '',
    expect: 'owned teardown is judged by its own process, never by the kill command',
  },
  {
    why: 'a browser stop whose kill cannot start is accepted',
    file: 'tools/check-browser.js',
    from: '  await kill(child, deadline);',
    to: '  await kill(child, deadline).catch(() => {});',
    expect: 'browser stop waits for the owned Edge to exit and fails while it keeps running',
  },
  {
    why: 'a filtered run judges the mutations its filter left out',
    file: 'tests/negative.js',
    from: '      if (!chosen.includes(m)) ' + 'continue;',
    to: '',
    expect: 'a filtered run judges only its mutations, still checks every patch text and says it was partial',
  },
  {
    why: 'a filtered run prints the full run summary',
    file: 'tests/negative.js',
    from: 'console.log(filter ' + '? `',
    to: 'console.log(false ? `',
    expect: 'a filtered run judges only its mutations, still checks every patch text and says it was partial',
  },
  {
    why: 'a filtered run skips the patch-text check of the other mutations',
    file: 'tests/negative.js',
    from: '      if (problem) { console.log(problem); ' + 'invalid++; }',
    to: '',
    expect: 'a filtered run judges only its mutations, still checks every patch text and says it was partial',
  },
  {
    why: 'every mutated copy stays until the run ends',
    file: 'tests/negative.js',
    from: '      try { await removeCopy(dir); } ' + 'catch (error) {',
    to: '      if (false) try { await removeCopy(dir); } catch (error) {',
    expect: 'the runner holds at most one mutated copy at a time and kept evidence survives each removal',
  },
  {
    why: 'the browser check leaves one example that declares sound without a film',
    file: 'tools/check-browser.js',
    from: '  const sounding = examples.filter((example) => example.sound);',
    to: '  const sounding = examples.filter((example) => example.sound).slice(1);',
    expect: 'the browser check exports a film for every example that declares sound, else the first with a timeline',
  },
  {
    why: 'the sheet image is taken before every planned cell exists',
    file: 'tools/check-browser.js',
    from: '  return !!sheet && sheet.cells.length === expected',
    to: '  return !!sheet && sheet.cells.length >= 1',
    expect: 'a sheet image waits until every planned cell has rendered or failed',
  },
  {
    why: 'the sheet image is taken while a cell has neither drawn nor failed',
    file: 'tools/check-browser.js',
    from: "    && sheet.cells.every((cell) => cell.error !== null || typeof cell.markCount === 'number');",
    to: '    && true;',
    expect: 'a sheet image waits until every planned cell has rendered or failed',
  },
  {
    why: 'npm run seeds ignores --png',
    file: 'tools/contact-sheet.js',
    from: "    if (arg === '--png') png = true;",
    to: "    if (arg === '--png') png = false;",
    expect: 'contact sheet: --png names the image beside the sheet, sizes it and counts the cells it waits for',
  },
  {
    why: 'a wide sweep image cuts off its last columns',
    file: 'tools/contact-sheet.js',
    from: '  return paramNames.length ? Math.max(1280, 48 + count * 220 + (count - 1) * 14) : 1280;',
    to: '  return 1280;',
    expect: 'contact sheet: --png names the image beside the sheet, sizes it and counts the cells it waits for',
  },
  {
    why: 'a list of pieces reports only each piece itself, so a caller splitting per piece leaves out the helpers it needs',
    file: 'tools/piece-input.js',
    from: '    if (!found.has(id)) { found.add(id); for (const next of requires.get(id)) reach(next, found); }',
    to: '    if (!found.has(id)) found.add(id);',
    expect: 'external pieces loaded as a list define a shared helper once and name what each piece reaches',
  },
  {
    why: 'a helper two pieces require is defined twice, under two ids',
    file: 'tools/piece-input.js',
    from: '    if (ids.has(file)) return ids.get(file);',
    to: '',
    expect: 'external pieces loaded as a list define a shared helper once and name what each piece reaches',
  },
  {
    why: 'two pieces of a list with the same name load, and the registry keeps only the second',
    file: 'tools/piece-input.js',
    from: '    if (named && named.entry !== entry) throw',
    to: '    if (false) throw',
    expect: 'external pieces loaded as a list define a shared helper once and name what each piece reaches',
  },
  {
    why: 'a confined piece requires a package or another library path, and Node resolves it',
    file: 'tools/piece-input.js',
    from: "          if (confine && dependency.spec[0] !== '.') throw outside(file, dependency.spec);",
    to: '',
    expect: 'external piece confined to its listed files refuses every other require by name',
  },
  {
    why: 'a confined piece requires a file outside its folder or one it does not list',
    file: 'tools/piece-input.js',
    from: '          if (confine && !listed(resolved)) throw',
    to: '          if (false) throw',
    expect: 'external piece confined to its listed files refuses every other require by name',
  },
  {
    why: 'a confined load starts from a piece that is not one of the listed files',
    file: 'tools/piece-input.js',
    from: '    if (confine && !listed(entry)) throw',
    to: '    if (false) throw',
    expect: 'external piece confined to its listed files refuses every other require by name',
  },
  {
    why: "Node runs an external piece through its own require, where it sees __dirname the page does not have",
    file: 'tools/piece-input.js',
    from: '    try { piece = validate(run(id)); }',
    to: '    try { piece = validate(require(entry)); }',
    expect: 'external piece runs in Node from the module table the page runs, without Node-only module globals',
  },
  {
    why: 'artifex/core/ names a file core/ does not have, and the load fails on a raw read error',
    file: 'tools/piece-input.js',
    from: '          if (!CORE.includes(core[1])) throw',
    to: '          if (false) throw',
    expect: 'external piece requires artifex/core modules from any folder, as the page resolves them',
  },
  {
    why: 'npm run styles resolves a relative ARTIFEX_HOME from the library, not from where it was invoked',
    file: 'tools/piece-input.js',
    from: "['page', 'seeds', 'replay', 'styles']",
    to: "['page', 'seeds', 'replay']",
    expect: 'npm run styles resolves ARTIFEX_HOME from the caller and lists, prints JSON and refuses by exit code',
  },
  {
    why: 'a style pack lists a file outside its folder with ..',
    file: 'tools/styles.js',
    from: "  if (parts.includes('..')) return",
    to: '  if (false) return',
    expect: 'style.json validation refuses each broken rule by name',
  },
  {
    why: 'a style pack lists a file with a backslash, which names another file on each system',
    file: 'tools/styles.js',
    from: "  if (file.includes('\\\\')) return",
    to: '  if (false) return',
    expect: 'style.json validation refuses each broken rule by name',
  },
  {
    why: 'style.json accepts keys the format does not define',
    file: 'tools/styles.js',
    from: '  for (const key of Object.keys(m)) if (!KEYS.includes(key)) bad(',
    to: '  for (const key of Object.keys(m)) if (false) bad(',
    expect: 'style.json validation refuses each broken rule by name',
  },
  {
    why: "a pack's name need not match its folder, so one folder can answer to another name",
    file: 'tools/styles.js',
    from: '  if (m.name !== folder) bad(',
    to: '  if (false) bad(',
    expect: 'style.json validation refuses each broken rule by name',
  },
  {
    why: 'an installed pack takes a built-in style\'s name',
    file: 'tools/styles.js',
    from: '    if (reserved.has(m.name)) {',
    to: '    if (false) {',
    expect: 'an installed pack with a built-in name is refused and the built-in style is used',
  },
  {
    why: 'a pack counts as trusted by its name, so a changed pack or a new version needs no new trust',
    file: 'tools/styles.js',
    from: '      trusted: trusted[m.name]?.sha256 === hash,',
    to: '      trusted: Boolean(trusted[m.name]),',
    expect: 'trust records the hash of style.json and check refuses a pack changed since',
  },
  {
    why: 'check runs a pack nobody trusted',
    file: 'tools/styles.js',
    from: '  if (!style.trusted) {',
    to: '  if (false) {',
    expect: 'trust records the hash of style.json and check refuses a pack changed since',
  },
  {
    why: "a pack file that differs from its hash in style.json is used",
    file: 'tools/styles.js',
    from: '    if (sha256(fs.readFileSync(path.join(folder, file))) !== hash) throw',
    to: '    if (false) throw',
    expect: 'every use refuses a pack whose files differ from style.json',
  },
  {
    why: 'a pack carries a loadable file style.json does not list, so no hash covers it',
    file: 'tools/styles.js',
    from: "      if (file !== 'style.json' && LOADABLE.test(file) && !Object.hasOwn(m.files, file)) {",
    to: '      if (false) {',
    expect: 'every use refuses a pack whose files differ from style.json',
  },
  {
    why: 'trust records a pack whose files differ from its style.json',
    file: 'tools/styles.js',
    from: '  verify(style);\n  const m = style.manifest;',
    to: '  const m = style.manifest;',
    expect: 'every use refuses a pack whose files differ from style.json',
  },
  {
    why: 'a pack holds a link to files outside it',
    file: 'tools/styles.js',
    from: "      if (entry.isSymbolicLink()) throw new Error('style: ' + pack.name",
    to: "      if (false) throw new Error('style: ' + pack.name",
    expect: 'a pack holding a link is refused, as is a linked pack folder',
  },
  {
    why: "a pack's sample was drawn by another Artifex version than style.json claims",
    file: 'tools/styles.js',
    from: '  if (manifest.artifex !== m.artifex) {',
    to: '  if (false) {',
    expect: 'check refuses a pack proved on another version and a piece that requires outside its files',
  },
  {
    why: 'check passes a pack proved on another Artifex version',
    file: 'tools/styles.js',
    from: 'load(name, env, (message) => { throw new Error(message); })',
    to: 'load(name, env, () => {})',
    expect: 'check refuses a pack proved on another version and a piece that requires outside its files',
  },
  {
    why: "check loads a pack's piece unconfined, so it may require files outside the pack",
    file: 'tools/styles.js',
    from: '{ ...loadExternal(style.piece, style.folder, { confine: { root: style.folder, files } }), ...named }',
    to: '{ ...loadExternal(style.piece, style.folder), ...named }',
    expect: 'check refuses a pack proved on another version and a piece that requires outside its files',
  },
  {
    why: '--style draws a pack proved on another Artifex version without saying its sample is not proved here',
    file: 'tools/styles.js',
    from: '  if (!style.proved) unproved(',
    to: '  if (false) unproved(',
    expect: 'a style loads by name for page and seeds: a built-in module, or a trusted pack before its code runs',
  },
  {
    why: 'a style name in another case names no style',
    file: 'tools/styles.js',
    from: '  const wanted = String(name).toLowerCase();',
    to: '  const wanted = String(name);',
    expect: 'a style loads by name for page and seeds: a built-in module, or a trusted pack before its code runs',
  },
  {
    why: '--style writes a built-in style\'s page beside its module in the skill folder instead of under out/',
    file: 'tools/styles.js',
    from: "  const named = { style, stem: 'style-' + style.name, directory: path.resolve(__dirname, '..', 'out') };",
    to: "  const named = { style, stem: 'style-' + style.name, directory: path.dirname(style.piece) };",
    expect: 'a style loads by name for page and seeds: a built-in module, or a trusted pack before its code runs',
  },
  {
    why: '--style names its page and sheet after the style alone, where a piece of that name would write',
    file: 'tools/styles.js',
    from: "stem: 'style-' + style.name,",
    to: 'stem: style.name,',
    expect: 'npm run page and seeds take --style, write out/style-<name>-page.html and -seeds.html, and refuse by exit code',
  },
  {
    why: 'npm run page prints a stack trace around a refused style instead of its reason',
    file: 'tools/build-page.js',
    from: '  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }',
    to: '  main();',
    expect: 'npm run page and seeds take --style, write out/style-<name>-page.html and -seeds.html, and refuse by exit code',
  },
  {
    why: 'npm run seeds throws a refused style past its catch, printing a stack trace instead of its reason',
    file: 'tools/contact-sheet.js',
    from: 'Promise.resolve().then(main).catch(',
    to: 'Promise.resolve(main()).catch(',
    expect: 'npm run page and seeds take --style, write out/style-<name>-page.html and -seeds.html, and refuse by exit code',
  },
  {
    why: 'npm run seeds -- --style takes its count as a piece name',
    file: 'tools/contact-sheet.js',
    from: '  const [which, n, t] = style ? [null, ...positional] : positional;',
    to: '  const [which, n, t] = positional;',
    expect: 'contact sheet: --style draws a style by name and names the sheet after it under out/',
  },
  {
    why: 'the run root takes a long name, so a nested run passes the Windows path limit',
    file: 'tests/negative.js',
    from: "const RUN_PREFIX = 'artifex-" + "neg-';",
    to: "const RUN_PREFIX = 'artifex-negative-mutation-run-';",
    expect: 'every path a mutation run creates stays under the Windows limit with a 120-character TEMP',
  },
  {
    why: 'a run forced to refuse AAC refuses nothing, so the film keeps AAC and the Opus fallback goes unchecked',
    file: 'tools/check-browser.js',
    from: '(/^mp4a\\./.test(config.codec)',
    to: '(/^mp4a-never\\./.test(config.codec)',
    expect: 'each forced condition takes away one codec or context, from its source text, and leaves the rest to the browser',
  },
  {
    why: 'a run forced to hide WebGL2 leaves it, so the colour is converted on the GPU and the CPU route goes unchecked',
    file: 'tools/check-browser.js',
    from: "return type === 'webgl2' ? null : get.call(this, type, ...rest);",
    to: 'return get.call(this, type, ...rest);',
    expect: 'each forced condition takes away one codec or context, from its source text, and leaves the rest to the browser',
  },
  {
    why: 'the browser check takes a second --force, so a verdict can name only one of the conditions it ran under',
    file: 'tools/check-browser.js',
    from: "arg === '--force' && !options.force && ",
    to: "arg === '--force' && ",
    expect: 'the browser check forces one named export fallback per run, and the default run none',
  },
  {
    why: "a forced run's summary reads as the default run's",
    file: 'tools/check-browser.js',
    from: "(report.forced ? ' with ' + FORCED[report.forced].means : '')",
    to: "''",
    expect: 'a forced run names its condition in its summary and report, and the default summary is unchanged',
  },
  {
    why: 'a forced WebM run records a fourth time, so a machine too loaded to record passes on persistence',
    file: 'tools/check-browser.js',
    from: 'refusals.length + 1 >= limit',
    to: 'refusals.length >= limit',
    expect: 'a forced WebM run records again only when the page refuses a recording as behind schedule, three recordings at most',
  },
  {
    why: 'a forced WebM run records again after any refusal, so a recording that lost pictures is tried until one passes',
    file: 'tools/check-browser.js',
    from: 'const behind = /fell (\\d+) ms behind its schedule/.exec(error.message);',
    to: 'const behind = /fell (\\d+) ms behind its schedule|$/.exec(error.message);',
    expect: 'a forced WebM run records again only when the page refuses a recording as behind schedule, three recordings at most',
  },
  {
    why: 'the browser check accepts a decoded frame that looks more like its neighbour, so a film shifted by a frame passes',
    file: 'tools/check-browser.js',
    from: 'if (best[1] > own)',
    to: 'if (false)',
    expect: 'a decoded frame matches its drawn frame only when it scores at least 30 dB and no neighbour scores higher',
  },
  {
    why: 'the browser check refuses a held frame that ties with its neighbour, so every film with a still stretch fails',
    file: 'tools/check-browser.js',
    from: 'if (best[1] > own)',
    to: 'if (best[1] >= own)',
    expect: 'a decoded frame matches its drawn frame only when it scores at least 30 dB and no neighbour scores higher',
  },
  {
    why: 'the browser check accepts decoded frames down to 20 dB from their drawing, so a garbled film that is garbled alike in every frame passes',
    file: 'tools/check-browser.js',
    from: 'floorDb = 30',
    to: 'floorDb = 20',
    expect: 'a decoded frame matches its drawn frame only when it scores at least 30 dB and no neighbour scores higher',
  },
  {
    why: 'the browser check accepts a decoded soundtrack 0.5 LU from -14 LUFS, so a film levelled wrong passes wherever its peak sits',
    file: 'tools/check-browser.js',
    from: 'Math.abs(heard.lufs + 14) <= 0.1 ||',
    to: 'Math.abs(heard.lufs + 14) <= 0.5 ||',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check accepts a soundtrack louder than -14 LUFS that peaks at its ceiling, so a gain past the target passes',
    file: 'tools/check-browser.js',
    from: '(heard.dbtp >= ceiling - within && heard.lufs < -14)',
    to: '(heard.dbtp >= ceiling - within)',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds a soundtrack stopped short to another ceiling than the export limits it under',
    file: 'tools/check-browser.js',
    from: '  const ceiling = -2, within',
    to: '  const ceiling = -1.5, within',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds Opus within 0.1 dB under its ceiling, under the 0.10 dB Opus lowered a peak in installed Edge',
    file: 'tools/check-browser.js',
    from: 'within = opus ? 0.15 : 0.1;',
    to: 'within = opus ? 0.1 : 0.1;',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds AAC only within 0.15 dB under its ceiling, wider than the 0.03 dB AAC lowers a peak',
    file: 'tools/check-browser.js',
    from: 'within = opus ? 0.15 : 0.1;',
    to: 'within = opus ? 0.15 : 0.15;',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check passes a soundtrack at -14 LUFS that decodes over -1 dBTP',
    file: 'tools/check-browser.js',
    from: '  if (!(heard.dbtp < -1)) return',
    to: '  if (false) return',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds only Opus under -1 dBTP, and a limited AAC soundtrack decoded over it passes',
    file: 'tools/check-browser.js',
    from: '  if (!(heard.dbtp < -1)) return',
    to: '  if (opus && !(heard.dbtp < -1)) return',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check never compares the reported shortfall with the level the export encoded at',
    file: 'tools/check-browser.js',
    from: '  if (under !== 3 && (sound.short !== undefined) !== under > 3) {',
    to: '  if (false) {',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check wants a shortfall from any soundtrack under -14 LUFS',
    file: 'tools/check-browser.js',
    from: '!== under > 3) {',
    to: '!== under > 0) {',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check refuses a report at exactly -17.00 LUFS whose shortfall, measured before rounding, is a hair past 3 LU',
    file: 'tools/check-browser.js',
    from: 'if (under !== 3 && (sound.short',
    to: 'if ((sound.short',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under -1 dBTP, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check leaves the shortfall out of its film report',
    file: 'tools/check-browser.js',
    from: 'dbtp: +heard.dbtp.toFixed(2), short: report.sound.short,',
    to: 'dbtp: +heard.dbtp.toFixed(2),',
    expect: 'the browser check carries a shortfall into its film report, and refuses a film whose decoded loudness loudnessMatch refuses',
  },
  {
    why: 'the browser check judges a film\'s loudness and never acts on the verdict',
    file: 'tools/check-browser.js',
    from: "    if (loud) throw new Error(name + ': ' + loud);\n",
    to: '',
    expect: 'the browser check carries a shortfall into its film report, and refuses a film whose decoded loudness loudnessMatch refuses',
  },
  {
    why: 'a run forced to refuse AAC exports only its first film, so no Opus soundtrack stopped at its ceiling is decoded',
    file: 'tools/check-browser.js',
    from: "options.force && options.force !== 'no-aac' ? chosen.slice(0, 1)",
    to: 'options.force ? chosen.slice(0, 1)',
    expect: 'a run forced to refuse AAC exports every film with sound, and every other forced run the first',
  },
  {
    why: 'every forced run exports every film, so a run forced to hide WebGL2 or refuse H.264 takes several times as long',
    file: 'tools/check-browser.js',
    from: "options.force && options.force !== 'no-aac' ? chosen.slice(0, 1)",
    to: 'false ? chosen.slice(0, 1)',
    expect: 'a run forced to refuse AAC exports every film with sound, and every other forced run the first',
  },
  {
    why: 'a default browser run passes a film whose encoder route fell back to the GPU or CPU',
    file: 'tools/check-browser.js',
    from: "  if (film.conversion === 'encoder' || options.allowFallback) return null;",
    to: "  return null;",
    expect: 'one function decides the colour route every film must take, for every run option',
  },
  {
    why: 'the browser check ignores --allow-fallback, so a machine without a usable GPU can never pass',
    file: 'tools/check-browser.js',
    from: "film.conversion === 'encoder' || options.allowFallback)",
    to: "film.conversion === 'encoder')",
    expect: 'one function decides the colour route every film must take, for every run option',
  },
  {
    why: 'a run forced without AAC stops requiring the encoder route',
    file: 'tools/check-browser.js',
    from: "film.conversion === 'encoder' || options.allowFallback)",
    to: "film.conversion === 'encoder' || options.allowFallback || options.force)",
    expect: 'one function decides the colour route every film must take, for every run option',
  },
  {
    why: 'a run that hides WebGL2 accepts a film the encoder or the GPU converted',
    file: 'tools/check-browser.js',
    from: "film.conversion === 'cpu' ? null :",
    to: "true ? null :",
    expect: 'one function decides the colour route every film must take, for every run option',
  },
  {
    why: 'the browser check computes a route verdict for each film and never acts on it',
    file: 'tools/check-browser.js',
    from: "    if (route) throw new Error('browser: ' + route);\n",
    to: "",
    expect: 'a default browser run requires every MP4 film on the encoder route, and --allow-fallback accepts the GPU or CPU',
  },
  {
    why: 'the browser report does not record that a run accepted a fallback colour route',
    file: 'tools/check-browser.js',
    from: '...(options.allowFallback && { allowFallback: true }), pieces,',
    to: 'pieces,',
    expect: 'a default browser run requires every MP4 film on the encoder route, and --allow-fallback accepts the GPU or CPU',
  },
  {
    why: 'the browser check takes --allow-fallback and still requires the encoder route',
    file: 'tools/check-browser.js',
    from: "else if (arg === '--allow-fallback') options.allowFallback = true;",
    to: "else if (arg === '--allow-fallback') options.allowFallback = false;",
    expect: 'the browser check accepts a fallback colour route only when asked',
  },
  {
    why: 'a run that accepted a fallback colour route reads as a default run in its summary',
    file: 'tools/check-browser.js',
    from: "(report.allowFallback ? (report.forced ? ',' : '') + ' accepting a fallback colour route' : '')",
    to: "''",
    expect: 'a run that accepts a fallback colour route says so in its summary',
  },
  {
    why: 'replay compares a file made by another library version',
    file: 'tools/replay.js',
    from: '  if (manifest.artifex !== VERSION) {',
    to: '  if (false) {',
    expect: 'a file made by another version, for another piece, box or outputs is refused, never compared',
  },
  {
    why: 'replay compares a file with a module of another piece',
    file: 'tools/replay.js',
    from: '  if (piece.name !== manifest.piece) {',
    to: '  if (false) {',
    expect: 'a file made by another version, for another piece, box or outputs is refused, never compared',
  },
  {
    why: 'replay compares a file drawn at a box the piece no longer has',
    file: 'tools/replay.js',
    from: '  if (!same(manifest.size, { w: piece.size.w, h: piece.size.h })) {',
    to: '  if (false) {',
    expect: 'a file made by another version, for another piece, box or outputs is refused, never compared',
  },
  {
    why: 'an SVG replay reports a match whatever the bytes',
    file: 'tools/replay.js',
    from: '  if (at === saved.length && at === again.length) return { match: true',
    to: '  if (true) return { match: true',
    expect: 'an SVG whose drawing or recipe differs is named by its first differing byte',
  },
  {
    why: "an SVG replay draws the piece's own seed instead of the recipe's",
    file: 'tools/replay.js',
    from: 'renderVector(piece, { seed: manifest.seed, params: manifest.params, t: manifest.t })',
    to: 'renderVector(piece, { params: manifest.params, t: manifest.t })',
    expect: 'an SVG replays byte for byte from the manifest it carries',
  },
  {
    why: 'a film replay compares a film cut on another frame grid',
    file: 'tools/replay.js',
    from: '    if (grid[k] !== now[k]) throw',
    to: '    if (false) throw',
    expect: 'a film is checked against its frame grid, size and frame count before any browser starts',
  },
  {
    why: 'a film replay compares a film of another size',
    file: 'tools/replay.js',
    from: '  if (video.width !== size.w || video.height !== size.h) {',
    to: '  if (false) {',
    expect: 'a film is checked against its frame grid, size and frame count before any browser starts',
  },
  {
    why: 'a film frame far from its redraw still matches',
    file: 'tools/replay.js',
    from: '    if (!(r.psnr >= FILM_FLOOR_DB)) {',
    to: '    if (false) {',
    expect: 'a film matches only where every compared frame is within the floor of its redraw and closest to its own',
  },
  {
    why: 'a film frame closer to its neighbour than to itself still matches',
    file: 'tools/replay.js',
    from: '    const closer = r.neighbours.find((n) => n.psnr > r.psnr);',
    to: '    const closer = null;',
    expect: 'a film matches only where every compared frame is within the floor of its redraw and closest to its own',
  },
  {
    why: 'a film whose pictures match replays as a match whatever its soundtrack',
    file: 'tools/replay.js',
    from: '  if (heard && !heard.match) return heard;',
    to: '',
    expect: 'a film whose pictures match still differs by its soundtrack, and pictures are named first',
  },
  {
    why: 'a soundtrack cut short replays as a match',
    file: 'tools/replay.js',
    from: '  if (s.length[0] !== s.length[1]) return',
    to: '  if (false) return',
    expect: 'a film soundtrack matches only where it decodes to its recipe, levelled as the export levels it',
  },
  {
    why: 'a soundtrack block under its codec floor passes',
    file: 'tools/replay.js',
    from: '    if (db >= floor) { worst = Math.min(worst, db); continue; }',
    to: '    if (true) { worst = Math.min(worst, db); continue; }',
    expect: 'a soundtrack block is judged against its codec floor unless the difference is under the gate',
  },
  {
    why: 'the soundtrack gate skips a block by its rendered level, so sound where the recipe is silent passes',
    file: 'tools/replay.js',
    from: '    if (error / samples < 10 ** (SOUND_GATE_DB / 10)) continue;',
    to: '    if (signal / samples < 10 ** (SOUND_GATE_DB / 10)) continue;',
    expect: 'a soundtrack block is judged against its codec floor unless the difference is under the gate',
  },
  {
    why: 'replay compares a film soundtrack with its recipe unlevelled',
    file: 'tools/replay.js',
    from: '  const { gain, limited } = api.level(rendered, codec);',
    to: '  const { gain, limited } = { gain: 0 };',
    expect: 'a film soundtrack matches only where it decodes to its recipe, levelled as the export levels it',
  },
  {
    why: 'a film that lost its soundtrack replays as one whose piece has none',
    file: 'tools/replay.js',
    from: '  if (!track) return {',
    to: '  if (!track) return null; if (false) return {',
    expect: 'a film and its piece must agree on whether there is a soundtrack, in a codec the export writes',
  },
  {
    why: 'replay levels a soundtrack by one gain of its own, unlimited, where the export limited its peaks',
    file: 'tools/replay.js',
    from: '  const { gain, limited } = api.level(rendered, codec);',
    to: '  const gain = Math.min(-14 - api.loudness(rendered).lufs, -1 - api.loudness(rendered).dbtp), limited = undefined; for (let c = 0; c < rendered.numberOfChannels; c++) rendered.getChannelData(c).forEach((v, i, x) => { x[i] = v * 10 ** (gain / 20); });',
    expect: 'replay levels a soundtrack with the gain and limiter the export applies',
  },
  {
    why: 'an AAC soundtrack is held only to the floor Opus noise needs',
    file: 'tools/replay.js',
    from: 'const SOUND_FLOOR_DB = { mp4a: 25, Opus: 15 };',
    to: 'const SOUND_FLOOR_DB = { mp4a: 15, Opus: 15 };',
    expect: 'a soundtrack block is judged against its codec floor unless the difference is under the gate',
  },
  {
    why: 'the shared stand-in canvas reads back image data without its size, which a browser always gives',
    file: 'tests/fake-media.js',
    from: 'return { width: w, height: h, data };',
    to: 'return { data };',
    expect: 'contact sheet: metrics forward native state and methods and count only successful paint calls',
  },
  {
    why: 'the shared stand-in canvas gives a 2D context that does not name its canvas, which a browser always does',
    file: 'tests/fake-media.js',
    from: '      canvas,\n',
    to: '',
    expect: 'contact sheet: metrics forward native state and methods and count only successful paint calls',
  },
  {
    why: 'the shared stand-in canvas fills at the colour\'s alpha alone, so a piece\'s globalAlpha never reaches the pixels',
    file: 'tests/fake-media.js',
    from: '(px, p) => blend(px, p, [r, gr, b], (a / 255) * this.globalAlpha));',
    to: '(px, p) => blend(px, p, [r, gr, b], a / 255));',
    expect: 'the shared stand-in canvas paints under transforms, globalAlpha and region copies as a canvas does',
  },
  {
    why: 'the shared stand-in canvas leaves out a pixel whose centre lies on a rectangle\'s top or left edge',
    file: 'tests/fake-media.js',
    from: 'if (u >= u0 && u < u1 && v >= v0 && v < v1)',
    to: 'if (u > u0 && u < u1 && v > v0 && v < v1)',
    expect: 'the shared stand-in canvas paints under transforms, globalAlpha and region copies as a canvas does',
  },
  {
    why: 'the shared stand-in canvas fills rectangles without the transform, so a scaled frame paints at scale 1',
    file: 'tests/fake-media.js',
    from: 'cover(this.getTransform(), x, y, w, h, (px, p) => blend(',
    to: 'cover({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, x, y, w, h, (px, p) => blend(',
    expect: 'the shared stand-in canvas paints under transforms, globalAlpha and region copies as a canvas does',
  },
  {
    why: 'the shared stand-in canvas copies a source region from the image\'s corner instead of the region',
    file: 'tests/fake-media.js',
    from: 'const [X, Y, u, v] = [x0 + i, y0 + j, sx + i, sy + j];',
    to: 'const [X, Y, u, v] = [x0 + i, y0 + j, i, j];',
    expect: 'the shared stand-in canvas paints under transforms, globalAlpha and region copies as a canvas does',
  },
  {
    why: 'the shared stand-in canvas draws an image at full opacity whatever globalAlpha says',
    file: 'tests/fake-media.js',
    from: '(from[s + 3] / 255) * this.globalAlpha);',
    to: 'from[s + 3] / 255);',
    expect: 'the shared stand-in canvas paints under transforms, globalAlpha and region copies as a canvas does',
  },
  {
    why: 'the shared stand-in canvas makes a new context on every getContext, losing the transform and the state a canvas keeps',
    file: 'tests/fake-media.js',
    from: 'if (made) return type === madeType ? made : null;',
    to: 'if (false) return made;',
    expect: 'the shared stand-in canvas paints under transforms, globalAlpha and region copies as a canvas does',
  },
  {
    why: 'the shared stand-in canvas paints source-over under any composite operation, so a lighter or multiply mark passes as a plain one',
    file: 'tests/fake-media.js',
    from: "if (g.globalCompositeOperation !== 'source-over') throw",
    to: 'if (false) throw',
    expect: 'the shared stand-in canvas paints under transforms, globalAlpha and region copies as a canvas does',
  },
  {
    why: 'replay finds no recipe in a PNG the page saved',
    file: 'tools/replay.js',
    from: '  png: pngManifest,',
    to: '  png: () => null,',
    expect: 'a PNG from the page is checked against its scale, size and playhead before any browser starts',
  },
  {
    why: 'a PNG replay compares a PNG drawn at another scale',
    file: 'tools/replay.js',
    from: '  if (got.w !== size.w || got.h !== size.h) throw new Error(`replay: the PNG is',
    to: '  if (false) throw new Error(`replay: the PNG is',
    expect: 'a PNG from the page is checked against its scale, size and playhead before any browser starts',
  },
  {
    why: 'a PNG replay redraws a playhead that is no frame of the piece',
    file: 'tools/replay.js',
    from: "  if (at < 0) throw new Error(`replay: the PNG's playhead",
    to: "  if (false) throw new Error(`replay: the PNG's playhead",
    expect: 'a PNG from the page is checked against its scale, size and playhead before any browser starts',
  },
  {
    why: 'a PNG far from its redraw still matches',
    file: 'tools/replay.js',
    from: '  if (!(own.psnr >= PNG_FLOOR_DB)) {',
    to: '  if (false) {',
    expect: 'a PNG matches when identical to its redraw, or within the floor and closest to its own frame',
  },
  {
    why: 'a PNG closer to a neighbouring frame than to its own still matches',
    file: 'tools/replay.js',
    from: '  const closer = rows.find((r) => r.frame !== at && r.psnr > own.psnr);',
    to: '  const closer = null;',
    expect: 'a PNG matches when identical to its redraw, or within the floor and closest to its own frame',
  },
  {
    why: 'a WebM replay seeks each frame on the frame grid, where the recorder\'s clock can have put its neighbour',
    file: 'tools/replay.js',
    from: '  return { frames, seeks: frames.map((i) => (times[i] + end(i)) / 2000) };',
    to: '  return { frames, seeks: frames.map((i) => (i + 0.5) / grid.hz) };',
    expect: 'a WebM from the page is checked like a film, and each frame is sought within its own block',
  },
  {
    why: 'a WebM replay compares a film cut on another frame grid',
    file: 'tools/replay.js',
    from: "  const off = ['frames', 'hz', 'loop'].find((k) => grid[k] !== now[k]);",
    to: "  const off = null;",
    expect: 'a WebM from the page is checked like a film, and each frame is sought within its own block',
  },
  {
    why: 'a WebM replay compares a film missing frames',
    file: 'tools/replay.js',
    from: '  if (times.length !== grid.frames) throw',
    to: '  if (false) throw',
    expect: 'a WebM from the page is checked like a film, and each frame is sought within its own block',
  },
  {
    why: 'a WebM replay compares a film of another size',
    file: 'tools/replay.js',
    from: '  if (got.w !== size.w || got.h !== size.h) throw new Error(`replay: the film is',
    to: '  if (false) throw new Error(`replay: the film is',
    expect: 'a WebM from the page is checked like a film, and each frame is sought within its own block',
  },
  {
    why: "the film replay indexes the page's examples with any name, inherited or missing",
    file: 'tools/replay.js',
    from: 'async function compareFilm(bytes, recipe, frames) {\n  const api = window.__artifex;\n  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw',
    to: 'async function compareFilm(bytes, recipe, frames) {\n  const api = window.__artifex;\n  if (false) throw',
    expect: 'every page function refuses a piece name that is not its own the same way',
  },
  {
    why: "the soundtrack replay indexes the page's examples with any name, inherited or missing",
    file: 'tools/replay.js',
    from: 'async function compareSound(bytes, recipe, block, codec, band, flatness, cut) {\n  const api = window.__artifex;\n  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw',
    to: 'async function compareSound(bytes, recipe, block, codec, band, flatness, cut) {\n  const api = window.__artifex;\n  if (false) throw',
    expect: 'every page function refuses a piece name that is not its own the same way',
  },
  {
    why: 'a file goes into the page as one message, which Edge closes the connection on past 100 MB',
    file: 'tools/replay.js',
    from: 'Buffer.from(bytes.subarray(at, at + piece))',
    to: 'Buffer.from(bytes.subarray(at))',
    expect: 'a file too large for one message reaches the page whole, one piece per message',
  },
  {
    why: "a piece lost on the way leaves zeros in the page's file and the replay carries on",
    file: 'tools/replay.js',
    from: '  if (held !== bytes.length) throw',
    to: '  if (false) throw',
    expect: 'a file too large for one message reaches the page whole, one piece per message',
  },
  {
    why: 'the SVG manifest reader leaves quotes escaped, so no recipe parses',
    file: 'core/surface-vector.js',
    from: "  const text = found[1].replace(/&(amp|lt|gt|quot);/g, (_, k) => ({ amp: '&', lt: '<', gt: '>', quot: '\"' })[k]);",
    to: "  const text = found[1].replace(/&(amp|lt|gt);/g, (_, k) => ({ amp: '&', lt: '<', gt: '>' })[k]);",
    expect: 'a render carries a manifest of how to make it again',
  },
  {
    why: 'the browser check reads a decoded frame by drawing the video element, which Edge can convert away from the pixels the film carries',
    file: 'tools/check-browser.js',
    from: '    try { got = pixels(frame); } finally { frame.close(); }',
    to: '    try { got = pixels(video); } finally { frame.close(); }',
    expect: 'the browser check scores each decoded frame by the pixels its VideoFrame holds, and closes every frame',
  },
  {
    why: 'the browser check leaves every VideoFrame it reads open, holding decoder memory',
    file: 'tools/check-browser.js',
    from: '    try { got = pixels(frame); } finally { frame.close(); }',
    to: '    try { got = pixels(frame); } finally { /* left open */ }',
    expect: 'the browser check scores each decoded frame by the pixels its VideoFrame holds, and closes every frame',
  },
  {
    why: 'replay reads a decoded film frame by drawing the video element, which Edge can convert away from the pixels the film carries',
    file: 'tools/replay.js',
    from: "    // software-decoded frame's colours differently from the pixels it carries.\n    const frame = new VideoFrame(video);\n    let got;\n"
      + '    try { got = shrink(frame); } finally { frame.close(); }',
    to: "    // software-decoded frame's colours differently from the pixels it carries.\n    const frame = new VideoFrame(video);\n    let got;\n"
      + '    try { got = shrink(video); } finally { frame.close(); }',
    expect: 'replay scores each decoded film frame by the pixels its VideoFrame holds, and closes every frame',
  },
  {
    why: 'replay leaves every VideoFrame it reads open, holding decoder memory',
    file: 'tools/replay.js',
    from: "    // software-decoded frame's colours differently from the pixels it carries.\n    const frame = new VideoFrame(video);\n    let got;\n"
      + '    try { got = shrink(frame); } finally { frame.close(); }',
    to: "    // software-decoded frame's colours differently from the pixels it carries.\n    const frame = new VideoFrame(video);\n    let got;\n"
      + '    try { got = shrink(frame); } finally { /* left open */ }',
    expect: 'replay scores each decoded film frame by the pixels its VideoFrame holds, and closes every frame',
  },
  {
    why: 'the browser check reads a film back in one reply, which Node\'s WebSocket refuses past 4 MiB',
    file: 'tools/check-browser.js',
    from: "    const film = await evaluateInPieces(client, '((frameMatch, soundMatch, loudnessMatch) => (' + inspectFilm.toString() + ')(' + JSON.stringify(name)",
    to: "    const film = await evaluate(client, '((frameMatch, soundMatch, loudnessMatch) => (' + inspectFilm.toString() + ')(' + JSON.stringify(name)",
    expect: 'a forced WebM run reads back a recording past 4 MiB whole',
  },
  {
    why: 'each piece runs to the end of the value, so the first reply carries it all',
    file: 'tools/check-browser.js',
    from: "  for (let at = 0; at < length; at += piece) text += await evaluate(client, 'globalThis.__artifexValue.slice(' + at + ', ' + (at + piece) + ')');",
    to: "  for (let at = 0; at < length; at += piece) text += await evaluate(client, 'globalThis.__artifexValue.slice(' + at + ')');",
    expect: 'a value past the 4 MiB a reply may carry crosses from the page whole, in pieces',
  },
  {
    why: 'the pieces overlap by a character, so the value arrives garbled',
    file: 'tools/check-browser.js',
    from: "  for (let at = 0; at < length; at += piece) text += await evaluate(client, 'globalThis.__artifexValue.slice(' + at + ', ' + (at + piece) + ')');",
    to: "  for (let at = 0; at < length; at += piece - 1) text += await evaluate(client, 'globalThis.__artifexValue.slice(' + at + ', ' + (at + piece) + ')');",
    expect: 'a value past the 4 MiB a reply may carry crosses from the page whole, in pieces',
  },
  {
    why: 'the page keeps its copy of a value after the last piece is read',
    file: 'tools/check-browser.js',
    from: "  await evaluate(client, 'delete globalThis.__artifexValue');",
    to: '',
    expect: 'a value past the 4 MiB a reply may carry crosses from the page whole, in pieces',
  },
  {
    why: 'a screenshot band is sized for two bytes a pixel, so a sheet that does not compress passes the reply limit',
    file: 'tools/check-browser.js',
    from: '  return Math.floor(SHOT_BYTES / (1 + 4 * width));',
    to: '  return Math.floor(SHOT_BYTES / (1 + 2 * width));',
    expect: 'a band holds as many rows as fit in one reply even if no pixel compresses',
  },
  {
    why: 'a piece may weigh the whole 4 MiB, leaving nothing for the reply or a whole shot heavier than its bands',
    file: 'tools/check-browser.js',
    from: 'const SHOT_BYTES = Math.floor(((4 * 1024 * 1024 - 65536) * 3) / 4);',
    to: 'const SHOT_BYTES = Math.floor((4 * 1024 * 1024 * 3) / 4);',
    expect: 'a band holds as many rows as fit in one reply even if no pixel compresses',
  },
  {
    why: 'bands join a piece whatever they weigh, so a heavy part is shot whole and the reply fails',
    file: 'tools/check-browser.js',
    from: '    if (last && last.bytes + bytes <= SHOT_BYTES) {',
    to: '    if (last) {',
    expect: 'a sheet part too heavy for one screenshot reply is shot in pieces that each fit, top to bottom',
  },
  {
    why: 'a piece forgets what its bands weigh, so it grows past the reply limit',
    file: 'tools/check-browser.js',
    from: '{ last.rows += count; last.bytes += bytes; }',
    to: '{ last.rows += count; }',
    expect: 'a sheet part too heavy for one screenshot reply is shot in pieces that each fit, top to bottom',
  },
  {
    why: 'every piece is shot from the top of the part, so later files repeat the first rows',
    file: 'tools/check-browser.js',
    from: '    piece.png = await shoot(piece.from, piece.rows);',
    to: '    piece.png = await shoot(0, piece.rows);',
    expect: 'a sheet part too heavy for one screenshot reply is shot in pieces that each fit, top to bottom',
  },
  {
    why: 'every piece keeps the part name, so each file overwrites the one before',
    file: 'tools/check-browser.js',
    from: '    piece.file = pieces.length === 1 ? file :',
    to: '    piece.file = true ? file :',
    expect: 'a sheet part too heavy for one screenshot reply is shot in pieces that each fit, top to bottom',
  },
  {
    why: 'every sheet part is weighed in bands first, so a small sheet takes screenshots it does not need',
    file: 'tools/check-browser.js',
    from: '  if (rows <= band) return [{ file, from: 0, rows, png: await shoot(0, rows) }];',
    to: '',
    expect: 'a sheet part that fits in one screenshot reply keeps its one file and screenshot',
  },
  {
    why: 'a scaled piece asks exactly its rows, so Edge can give one row fewer and a sheet file loses its last row',
    file: 'tools/check-browser.js',
    from: 'height: scale < 1 ? (count + 0.5) / scale : count, scale };',
    to: 'height: scale < 1 ? count / scale : count, scale };',
    expect: 'a whole sheet part keeps its clip, and a scaled piece asks half a row more',
  },
  {
    why: 'an unscaled piece asks half a row more, which moves its pixels',
    file: 'tools/check-browser.js',
    from: 'height: scale < 1 ? (count + 0.5) / scale : count, scale };',
    to: 'height: (count + 0.5) / scale, scale };',
    expect: 'a whole sheet part keeps its clip, and a scaled piece asks half a row more',
  },
  {
    why: 'a whole scaled part takes the piece clip, so every scaled sheet file changes its pixels',
    file: 'tools/check-browser.js',
    from: '  if (count === Math.round(height * scale)) return { x: 0, y: top, width, height, scale };',
    to: '',
    expect: 'a whole sheet part keeps its clip, and a scaled piece asks half a row more',
  },
  {
    why: 'every piece is clipped from the top of its part, so later files repeat the first rows',
    file: 'tools/check-browser.js',
    from: '  return { x: 0, y: top + from / scale,',
    to: '  return { x: 0, y: top,',
    expect: 'a whole sheet part keeps its clip, and a scaled piece asks half a row more',
  },
  {
    why: 'the page stops exposing the loudness meter, so replay can no longer measure a decoded film and only Edge would notice',
    file: 'tools/build-page.js',
    from: '  loudness: film.measureLoudness,\n',
    to: '',
    expect: 'the page exposes the film loudness meter and levelling that replay reads, as core/film.js gives them',
  },
  {
    why: 'the page stops exposing the levelling, so replay can no longer level a soundtrack as the export did and only Edge would notice',
    file: 'tools/build-page.js',
    from: '  level: film.normalizeLoudness,\n',
    to: '',
    expect: 'the page exposes the film loudness meter and levelling that replay reads, as core/film.js gives them',
  },
  {
    why: 'the browser check takes a fresh render levelled otherwise than the export reported',
    file: 'tools/check-browser.js',
    from: '    if (fresh !== said) throw',
    to: '    if (false) throw',
    expect: 'the browser check carries a shortfall into its film report, and refuses a film whose decoded loudness loudnessMatch refuses',
  },
  {
    why: 'the browser check levels a fresh render for AAC whatever codec the film carries',
    file: 'tools/check-browser.js',
    from: '    const level = api.level(b, report.sound.codec);',
    to: "    const level = api.level(b, 'mp4a');",
    expect: 'the browser check carries a shortfall into its film report, and refuses a film whose decoded loudness loudnessMatch refuses',
  },
  {
    why: 'replay closes a WebM frame only after a read that succeeds, so a read that throws leaves the VideoFrame open',
    file: 'tools/replay.js',
    from: '      video.currentTime = seeks[n];\n    });\n    await new Promise((resolve) => setTimeout(resolve, 60));\n'
      + '    const frame = new VideoFrame(video);\n    let got;\n    try { got = shrink(frame); } finally { frame.close(); }\n',
    to: '      video.currentTime = seeks[n];\n    });\n    await new Promise((resolve) => setTimeout(resolve, 60));\n'
      + '    const frame = new VideoFrame(video);\n    const got = shrink(frame);\n    frame.close();\n',
    expect: 'a WebM frame whose read throws still closes the VideoFrame it was read through',
  },
  {
    why: 'a block under its floor matches by its noise-like bands whatever the rest of it decodes to, so a moved tone passes',
    file: 'tools/replay.js',
    from: '    if (!(10 * Math.log10(signal / Math.max(0, error - noiseError)) >= floor)) return',
    to: '    if (false) return',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'rounding that takes the rest of a block under zero refuses a block whose whole difference is in its noise-like bands',
    file: 'tools/replay.js',
    from: 'signal / Math.max(0, error - noiseError)',
    to: 'signal / (error - noiseError)',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'noise-like bands pass whatever waveform they decode to, so another noise passes',
    file: 'tools/replay.js',
    from: '    if (!(wave >= waveform)) return',
    to: '    if (false) return',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'noise-like bands pass whatever level they decode to, so a louder or quieter voice passes',
    file: 'tools/replay.js',
    from: '    if (!(kept >= level)) return',
    to: '    if (false) return',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'noise-like band levels are held only to 12 dB, which a voice 3 dB louder keeps',
    file: 'tools/replay.js',
    from: 'const SOUND_NOISE_DB = { waveform: 3, envelope: 18 };',
    to: 'const SOUND_NOISE_DB = { waveform: 3, envelope: 12 };',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'a band is noise-like at half the flatness, taking in more of a chord',
    file: 'tools/replay.js',
    from: 'const SOUND_FLATNESS = 0.4;',
    to: 'const SOUND_FLATNESS = 0.2;',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'noise-like bands are chosen from the unwindowed spectrum, whose leakage fills the bands between a chord\'s partials',
    file: 'tools/replay.js',
    from: 'wr[i - at] = x * hann[i - at];',
    to: 'wr[i - at] = x;',
    expect: 'a noise voice replays by what a perceptual codec keeps of it, and a different one still differs',
  },
  {
    why: 'every band is noise-like, so a tone is judged as noise',
    file: 'tools/replay.js',
    from: '>= flatness)) continue;',
    to: '>= 0)) continue;',
    expect: 'a noise voice replays by what a perceptual codec keeps of it, and a different one still differs',
  },
  {
    why: 'band energies count each mirrored bin once, so they no longer add up to the block and its difference meets the -60 dBFS gate 3 dB early',
    file: 'tools/replay.js',
    from: 'm = (k === bins - 1 ? 1 : 2) / block;',
    to: 'm = 1 / block;',
    expect: 'a film soundtrack matches only where it decodes to its recipe, levelled as the export levels it',
  },
  {
    why: 'the envelope error takes energies for amplitudes, too small to refuse a voice 6 dB louder or quieter',
    file: 'tools/replay.js',
    from: 'envelope += (Math.sqrt(got) - Math.sqrt(want)) ** 2;',
    to: 'envelope += (got - want) ** 2;',
    expect: 'a noise voice replays by what a perceptual codec keeps of it, and a different one still differs',
  },
  {
    why: 'replay never takes the codec\'s cut, so a hi-hat the AAC encoder cut above its low-pass differs',
    file: 'tools/replay.js',
    from: '{ top = band * Math.floor((k + 1) / band); break; }',
    to: '{ break; }',
    expect: 'a soundtrack is judged below the band its codec kept, measured from the film, and a different one still differs',
  },
  {
    why: 'blocks are still judged above the measured cut, so the band the encoder cut still differs',
    file: 'tools/replay.js',
    from: 'hi = Math.min(top, b === bands - 1',
    to: 'hi = Math.min(bins, b === bands - 1',
    expect: 'a soundtrack is judged below the band its codec kept, measured from the film, and a different one still differs',
  },
  {
    why: 'a cut is taken anywhere down the spectrum, so a film low-passed at 9 kHz matches',
    file: 'tools/replay.js',
    from: 'lost > 0 && k >= lowest && lost',
    to: 'lost > 0 && k >= 1 && lost',
    expect: 'a soundtrack is judged below the band its codec kept, measured from the film, and a different one still differs',
  },
  {
    why: 'a cut may fall over any width, so a gentle low-pass is taken for a codec\'s',
    file: 'tools/replay.js',
    from: 'lost - k <= band; k--) {',
    to: 'lost - k <= bins; k--) {',
    expect: 'a soundtrack is judged below the band its codec kept, measured from the film, and a different one still differs',
  },
  {
    why: 'the bin under a cut need not keep the render, so a film missing its only voice above 12 kHz is taken as cut',
    file: 'tools/replay.js',
    from: 'if (r !== null && r >= -cut.kept) {',
    to: 'if (r !== null) {',
    expect: 'a soundtrack is judged below the band its codec kept, measured from the film, and a different one still differs',
  },
  {
    why: 'a film that matches below its codec\'s cut no longer says where it was judged',
    file: 'tools/replay.js',
    from: "(s.cut ? ` and, below ${(s.cut / 1000).toFixed(2)} kHz, where its codec kept the render,` : ',')",
    to: "','",
    expect: 'a soundtrack is judged below the band its codec kept, measured from the film, and a different one still differs',
  },
  {
    why: 'a block\'s mean is judged, so the pluck whose mean Opus removed differs',
    file: 'tools/replay.js',
    from: '      for (let k = 1; k < bins; k++) {',
    to: '      for (let k = 0; k < bins; k++) {',
    expect: 'a soundtrack is judged without its mean, which Opus removes',
  },
  {
    why: 'a piece whose size lies outside the boxes it declares validates',
    file: 'core/piece.js',
    from: '  if (off) throw new PieceError(`boxes: size ${off}`);\n',
    to: '',
    expect: 'boxes are opt-in ranges that hold the size, and carry no other keys',
  },
  {
    why: 'atBox draws a piece at a box outside the ranges it declares',
    file: 'core/piece.js',
    from: '  if (off) throw new PieceError(`atBox: ${piece.name} cannot draw at',
    to: '  if (false) throw new PieceError(`atBox: ${piece.name} cannot draw at',
    expect: 'atBox redraws a piece at a declared box and refuses any other, by name',
  },
  {
    why: 'atBox stretches a piece that declares no boxes to any box asked of it',
    file: 'core/piece.js',
    from: '  if (!piece.boxes) {\n    throw new PieceError(`atBox:',
    to: '  if (false) {\n    throw new PieceError(`atBox:',
    expect: 'atBox redraws a piece at a declared box and refuses any other, by name',
  },
  {
    why: 'the build stages are never told the box they are solved for',
    file: 'core/piece.js',
    from: '  if (piece.boxes) state.box = { w: piece.size.w, h: piece.size.h };',
    to: '',
    expect: 'a piece that declares boxes is solved for its box, and the recipe names it',
  },
  {
    why: 'a piece that declares no boxes gets a box in its state it never had',
    file: 'core/piece.js',
    from: '  if (piece.boxes) state.box = { w: piece.size.w, h: piece.size.h };',
    to: '  state.box = { w: piece.size.w, h: piece.size.h };',
    expect: 'a piece that declares boxes is solved for its box, and the recipe names it',
  },
  {
    why: 'refit lets a thing rest above the rim of its container',
    file: 'examples/refit.js',
    from: '        if (best.y - r < c.rim) { misses++; continue; }',
    to: '        if (false) { misses++; continue; }',
    expect: 'refit: a narrower box holds fewer of the same things, each inside it and clear of the rest',
  },
  {
    why: 'replay draws a responsive piece at its default box, whatever box the file names',
    file: 'tools/replay.js',
    from: "  if (piece.boxes && manifest.size && typeof manifest.size === 'object') {",
    to: '  if (false) {',
    expect: 'a piece that declares boxes replays at the box its file names, and refuses a box it does not accept',
  },
  {
    why: 'a contact sheet draws at the piece\'s own box whatever --box names, and refuses nothing',
    file: 'tools/contact-sheet.js',
    from: '    return planSheet(box ? atBox(p, box) : p, count, paramNames);',
    to: '    return planSheet(p, count, paramNames);',
    expect: 'contact sheet: --box draws one piece at a box it declares, names the sheet after it, and refuses any other',
  },
  {
    why: 'the page opens a responsive piece at its default box whatever box the address bar names',
    file: 'tools/build-page.js',
    from: '    try { current = piece.atBox(base, from.box); }',
    to: '    try { current = base; }',
    expect: 'a piece that declares boxes opens at the address bar\'s box, rebuilds from its sliders and records the box',
  },
  {
    why: 'the page leaves the box out of the recipe URL, so a shared link opens at the default box',
    file: 'tools/build-page.js',
    from: "  if (base.boxes) q.push('box=' + current.size.w + 'x' + current.size.h);\n",
    to: '',
    expect: 'a piece that declares boxes opens at the address bar\'s box, rebuilds from its sliders and records the box',
  },
  ...['compareFilm(bytes, recipe, frames)', 'compareSound(bytes, recipe, block, codec, band, flatness, cut)', 'comparePng(bytes, recipe, heads, frames)', 'compareWebm(bytes, recipe, frames, seeks)'].map((head) => ({
    why: `replay's ${head.split('(')[0]} redraws a responsive piece at its default box, whatever box the file names`,
    file: 'tools/replay.js',
    from: `async function ${head} {\n  const api = window.__artifex;\n`
      + "  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));\n"
      + '  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.size);',
    to: `async function ${head} {\n  const api = window.__artifex;\n`
      + "  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));\n"
      + '  const p = api.piece.validate(api.examples[recipe.piece]);',
    expect: 'the page redraws a responsive film, its soundtrack, a PNG or a WebM at the box its recipe records',
  })),

];

// Copy only what `node --test tests/*.test.js` reads: the tests, their modules
// under `core/`, `examples/` and `tools/`, the styles under `skills/`, and
// `package.json`. Keeping an explicit allowlist prevents unrelated workspace
// data from increasing every copy.
//
// If a test ever reads something new, the control run goes red before any
// mutation is applied and says so by name. That is the failure announcing
// itself, which is the point.
//
// The names are the tree root's own, so the filter applies there and nowhere
// else: once inside `core/`, every file is taken.
const COPIED = new Set(['core', 'examples', 'skills', 'tests', 'tools', 'package.json']);

function copyDir(src, dst, root = false) {
  fs.mkdirSync(dst, { recursive: true });
  let bytes = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (root && !COPIED.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) bytes += copyDir(s, d);
    else { fs.copyFileSync(s, d); bytes += fs.statSync(s).size; }
  }
  return bytes;
}

/** Read Node's nested subtest scopes, excluding YAML diagnostic contents. */
function tapScopes(lines) {
  const root = { indent: 0, points: [], pending: null, plan: null };
  const scopes = [root], nodes = [];
  let diagnostic = null, previous = null;
  const invalid = (reason) => ({ failure: `incomplete or inconsistent TAP: ${reason}` });
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;
    const text = line.trimStart();
    if (diagnostic) {
      if (indent === diagnostic.indent && text === '...') diagnostic = null;
      else if (text && indent < diagnostic.indent) return invalid('unterminated diagnostic');
      else {
        diagnostic.node.detail.push(line.slice(diagnostic.indent));
        const type = indent === diagnostic.indent && /^type: ['"]?(test|suite)['"]?$/.exec(text);
        if (type) diagnostic.node.type = type[1];
      }
      continue;
    }
    if (!text) continue;
    if (text === '---') {
      if (!previous || indent !== previous.indent + 2) return invalid('diagnostic without a result');
      diagnostic = { indent, node: previous };
      previous = null;
      continue;
    }
    previous = null;
    const subtest = /^# Subtest: (.*)$/.exec(text);
    const point = /^(not ok|ok) (\d+) - (.+?)(?: # (SKIP|TODO)\b.*)?$/.exec(text);
    const plan = /^1\.\.(\d+)$/.exec(text);
    if (!subtest && !point && !plan) {
      if (text.startsWith('#')) continue;
      return invalid('unexpected output outside diagnostics');
    }
    while (indent < scopes.at(-1).indent) {
      const closed = scopes.pop();
      if (closed.plan === null || closed.pending) return invalid('nested scope has no complete plan');
    }
    let scope = scopes.at(-1);
    if (indent > scope.indent) {
      if (indent !== scope.indent + 4 || !scope.pending) return invalid('nested scope has no parent');
      scope = { indent, points: [], pending: null, plan: null };
      scopes.push(scope);
    }
    if (scope.plan !== null) return invalid('results follow a closed plan');
    if (subtest) {
      if (scope.pending) return invalid('subtest has no result');
      scope.pending = subtest[1];
    } else if (point) {
      if (scope.pending !== point[3] || Number(point[2]) !== scope.points.length + 1) {
        return invalid('missing, renamed or misnumbered subtest result');
      }
      const node = { indent, name: point[3], ok: point[1] === 'ok', directive: point[4], type: 'test', detail: [] };
      nodes.push(node);
      scope.points.push(node);
      scope.pending = null;
      previous = node;
    } else {
      if (scope.pending || Number(plan[1]) !== scope.points.length) return invalid('plan does not match its results');
      scope.plan = i;
    }
  }
  if (diagnostic || scopes.length !== 1 || root.pending || root.plan === null) return invalid('report was truncated');
  return { nodes, planLine: root.plan };
}

/** Validate Node's complete TAP scopes and summary, not arbitrary TAP producers. */
function suiteReport(stdout) {
  stdout = stdout.replace(/\r\n/g, '\n');
  const lines = stdout.split('\n');
  if (lines[0] !== 'TAP version 13' || !/^# duration_ms [\d.]+\s*$/.test(lines.filter(Boolean).at(-1) || '')) {
    return { failure: 'incomplete TAP header/footer' };
  }
  const tree = tapScopes(lines);
  if (tree.failure) return tree;
  const summary = {};
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const pattern = new RegExp(`^# ${key} (\\d+)$`);
    const matches = lines.flatMap((line, i) => {
      const match = pattern.exec(line);
      return match ? [{ value: Number(match[1]), line: i }] : [];
    });
    if (matches.length !== 1) return { failure: `missing or repeated TAP ${key} summary` };
    if (matches[0].line <= tree.planLine) return { failure: 'TAP summary precedes its completed plan' };
    summary[key] = matches[0].value;
  }
  const counts = { tests: 0, suites: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
  for (const node of tree.nodes) {
    if (node.type === 'suite') { counts.suites++; continue; }
    counts.tests++;
    const verdict = node.directive === 'SKIP' ? 'skipped' : node.directive === 'TODO' ? 'todo'
      : node.ok ? 'pass' : 'fail';
    counts[verdict]++;
  }
  const failedNodes = tree.nodes.filter((node) => !node.ok && !node.directive);
  const failed = failedNodes.map((node) => node.name);
  if (summary.tests < 1 || summary.pass + summary.fail < 1 || summary.cancelled !== 0
      || Object.keys(counts).some((key) => counts[key] !== summary[key])
      || (summary.fail > 0) !== (failed.length > 0)) {
    return { failure: 'incomplete or inconsistent TAP test counts' };
  }
  // Each failed result's YAML diagnostic, aligned with `failed`: the assertion, its values and location.
  const diagnostics = failedNodes.map((node) => node.detail.join('\n'));
  return { failed, diagnostics, names: tree.nodes.map((node) => node.name), summary };
}

function suiteDeadline(value = process.env.ARTIFEX_NEGATIVE_TIMEOUT_MS) {
  if (value === undefined) return 300000;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) {
    throw new RangeError('ARTIFEX_NEGATIVE_TIMEOUT_MS must be an integer from 1 to 2147483647');
  }
  return timeout;
}

/**
 * Stop only this child's Windows tree or its private POSIX process group, and
 * judge the stop by the child alone: it has exited, or is seen exiting within
 * `graceMs` of the kill ending. taskkill's exit code and localized output
 * decide nothing, because taskkill also fails when a member exits by itself
 * mid-kill. Node runs each Windows child in a kill-on-close job, so the
 * child's own descendants end with it. A kill that cannot start fails.
 */
function terminateSuite(child, graceMs = 5000) {
  return new Promise((resolve) => {
    const judge = (said) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(null); return; }
      const exited = () => { clearTimeout(grace); resolve(null); };
      const grace = setTimeout(() => {
        child.removeListener('exit', exited);
        resolve(new Error(`owned tree termination left process ${child.pid} running ${graceMs} ms after the kill${said}`));
      }, graceMs);
      child.once('exit', exited);
    };
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') { resolve(error); return; }
      }
      judge('');
      return;
    }
    let detail = '', failed = false;
    // Under CPU load taskkill itself can take seconds to start.
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, killSignal: 'SIGKILL',
    });
    // Kept only to explain a failure in the report.
    for (const stream of [killer.stdout, killer.stderr]) stream.on('data', (chunk) => {
      detail = (detail + chunk.toString('utf8')).slice(-2000);
    });
    killer.once('error', (error) => { failed = true; resolve(error); });
    killer.once('close', (code) => {
      if (!failed) judge(`; taskkill exited ${code}${detail.trim() ? ': ' + detail.trim() : ''}`);
    });
  });
}

// Short names for what a run creates. Windows' mkdtemp and process working
// directories fail past 260 characters, and a runner test nests a whole run of
// its own inside a copy: <TEMP>/<run>/<copy>/t/<fixture>/.../<run>/control/t/...
const RUN_PREFIX = 'artifex-neg-';
const SUITE_TEMP = 't';

/** Whether a PID still runs; EPERM means it exists but belongs to someone else. */
function running(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/**
 * Remove the copies left by runs whose runner process is gone, stopped before
 * its own cleanup. Only this runner's pid-named roots are considered, and
 * their kept infrastructure evidence stays for whoever reads their report.
 */
async function sweepStaleRuns(tempRoot = os.tmpdir()) {
  for (const name of fs.readdirSync(tempRoot)) {
    const owner = Number(new RegExp('^' + RUN_PREFIX + '(\\d+)-').exec(name)?.[1]);
    if (!owner || owner === process.pid || running(owner)) continue;
    const root = path.join(tempRoot, name);
    // A copy an orphaned process still holds stays until a later run.
    for (const entry of fs.readdirSync(root)) if (entry !== 'infrastructure') await removeCopy(path.join(root, entry), 0).catch(() => {});
    if (!fs.readdirSync(root).length) await removeCopy(root, 0).catch(() => {});
  }
}

/** Remove a copy whose stopped processes may still hold it: Windows releases their handles after they exit. */
async function removeCopy(dir, limitMs = 10000) {
  const deadline = Date.now() + limitMs;
  for (;;) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || Date.now() >= deadline) throw error;
      await sleep(100);
    }
  }
}

/** Bounded output and lifetime; closing a timed-out coordinator must also stop its test workers. */
function executeSuite(command, args, options) {
  const { timeout, ...spawnOptions } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...spawnOptions, windowsHide: true, detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', bytes = 0, error, terminationError;
    let settled = false, closed = false, terminating = false, teardownTimer;
    let status = null, signal = null;
    let termination = Promise.resolve();
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(teardownTimer);
      resolve({ status, signal, error, terminationError, stdout, stderr, pid: child.pid });
    };
    const stop = (code, message) => {
      if (terminating || settled) return;
      terminating = true;
      error = Object.assign(new Error(message), { code });
      clearTimeout(timer);
      // A failed OS tree-kill must return an infrastructure verdict, not wait
      // forever for inherited pipes. Retain that failure instead of claiming cleanup.
      teardownTimer = setTimeout(() => {
        terminationError ||= new Error('owned subprocess did not close within the 30-second teardown limit');
        try { child.kill('SIGKILL'); } catch (failure) { terminationError = failure; }
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish();
      }, 30000);
      termination = terminateSuite(child).then((failure) => {
        terminationError = failure || undefined;
        if (failure) {
          try { child.kill('SIGKILL'); } catch (killError) { terminationError = killError; }
        }
        if (closed) finish();
      });
    };
    const timer = setTimeout(() => stop('ETIMEDOUT', `suite exceeded its ${timeout}ms deadline`), timeout);
    const collect = (stream, chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > 1048576) { stop('ENOBUFS', 'suite output exceeded 1048576 bytes'); return; }
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.once('error', (failure) => { error ||= failure; });
    child.once('close', (code, closeSignal) => {
      closed = true;
      status = code;
      signal = closeSignal;
      clearTimeout(timer);
      termination.then(finish);
    });
  });
}

/** Keep process evidence even when no test runner starts or no TAP is emitted. */
async function runSuite(dir, execute = executeSuite, timeout) {
  const timeoutMs = suiteDeadline(timeout);
  let result;
  // A runner invoked from a regression test must start an independent suite.
  // Inheriting child-v8 makes Node skip the requested files with exit 0.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // A runner copy gives its suite a temporary directory inside itself, so
  // removing the copy also removes what a killed suite never cleaned up.
  const temp = path.join(dir, SUITE_TEMP);
  if (fs.existsSync(temp)) env.TEMP = env.TMP = env.TMPDIR = temp;
  try {
    result = await execute(process.execPath, ['--test', '--test-reporter=tap', 'tests/*.test.js'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, timeout: timeoutMs,
    });
  } catch (error) {
    result = { error, status: null, signal: null, stdout: '', stderr: '' };
  }
  const { status, signal, error } = result;
  const stdout = result.stdout || '', stderr = result.stderr || '';
  const report = suiteReport(stdout);
  let failure = null;
  if (error) failure = `process launch/execution failed (${error.code || error.name}): ${error.message}`;
  else if (signal) failure = `process terminated by ${signal}`;
  else if (status !== 0 && status !== 1) failure = `unexpected process exit status: ${status}`;
  else if (report.failure) failure = report.failure;
  else if ((status === 0) !== (report.summary.fail === 0)) failure = 'process exit status contradicts TAP failures';
  if (result.terminationError) failure = `${failure || 'process teardown failed'}; ${result.terminationError.message}`;
  return { ...result, status, signal, error, stdout, stderr, timeoutMs, timedOut: error?.code === 'ETIMEDOUT', ...report, failure };
}

/** Encode accepted Node 22 TAP titles after rejecting ambiguous control escapes. */
function tapName(name) {
  return name.replace(/\\/g, '\\\\').replace(/#/g, '\\#');
}

function mutationVerdict(result, expected) {
  if (result.failure) return 'infra';
  // Node encodes a control character and its literal escape identically. Even
  // one matching result cannot establish which source title actually failed.
  if (/[\b\f\t\n\r\v]|\\[bfnrtv]/.test(expected)) return 'infra';
  const encoded = tapName(expected);
  if (!Array.isArray(result.names) || result.names.filter((name) => name === encoded).length > 1) return 'infra';
  if (result.failed.length === 0) return 'escaped';
  return result.failed.includes(encoded) ? 'caught' : 'misnamed';
}

function infrastructureDetail(result) {
  const stderr = result.stderr.trim();
  const failure = result.failure || 'ambiguous TAP failure attribution: use a unique test title without control characters or literal control escapes';
  return `${failure}${stderr ? `\n                stderr: ${stderr.slice(-2000)}` : ''}`;
}

/** Each failed title with what its assertion saw, capped so one large value cannot flood the report. */
function failedDetail(result, indent) {
  return (result.failed || []).map((name, i) => {
    const detail = (result.diagnostics?.[i] || '').slice(0, 2000);
    return `${indent}${name}${detail ? `\n${detail.replace(/^/gm, `${indent}    `)}` : ''}`;
  }).join('\n');
}

/** Keep an infrastructure result's TAP, stderr and process metadata where removing the copies leaves them. */
function keepEvidence(dir, result) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stdout.tap'), result.stdout);
  fs.writeFileSync(path.join(dir, 'stderr.txt'), result.stderr);
  const { status, signal, error, terminationError, failure, timeoutMs, timedOut, pid } = result;
  fs.writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify({
    status, signal, failure, timeoutMs, timedOut, pid,
    error: error && { code: error.code, message: error.message }, terminationError: terminationError?.message,
  }, null, 2)}\n`);
  return dir;
}

/**
 * Judge one mutated copy. An infrastructure result keeps its evidence and runs
 * once more for the report only: the verdict stays infrastructure whatever the
 * second attempt shows, so load can never turn a failure into a pass.
 */
async function judgeMutation(dir, m, evidence, timeoutMs, execute = executeSuite) {
  const result = await runSuite(dir, execute, timeoutMs);
  const verdict = mutationVerdict(result, m.expect);
  if (verdict === 'caught') return { verdict, text: `ok              ${m.why}` };
  if (verdict === 'escaped') return { verdict, text: `ESCAPED         ${m.why}\n                nothing failed; no check covers this` };
  if (verdict === 'misnamed') {
    return { verdict, text: `MISNAMED        ${m.why}\n                expected: ${m.expect}\n                failed:\n${failedDetail(result, '                  ')}` };
  }
  const kept = keepEvidence(evidence, result);
  const again = await runSuite(dir, execute, timeoutMs);
  const retry = mutationVerdict(again, m.expect);
  const keptAgain = retry === 'infra' ? `, kept in ${keepEvidence(`${evidence}-retry`, again)}` : '';
  const failed = failedDetail(result, '                ');
  return {
    verdict, retry,
    text: `INFRA           ${m.why}\n                ${infrastructureDetail(result)}${failed ? `\n${failed}` : ''}`
      + `\n                kept in ${kept}\n                retry, report only: ${retry}${keptAgain}`,
  };
}

const USAGE = 'usage: node tests/negative.js [--file <mutated file>]... [--expect <text of the expected test title>]... [--shard <k>/<n>]';

/**
 * Choose the mutations to run; with no filter, all of them. `--file` matches a
 * mutated file's repository path and `--expect` text within the expected test
 * title. Repeating a kind widens it; giving both kinds requires both.
 * `--shard k/n` keeps every n-th mutation of the whole list from the k-th, so
 * shards 1 to n hold each mutation exactly once; it narrows the other filters.
 */
function selectMutations(args, mutations = MUTATIONS) {
  const files = [], expects = [], shards = [];
  for (let i = 0; i < args.length; i += 2) {
    const kind = { '--file': files, '--expect': expects, '--shard': shards }[args[i]];
    if (!kind || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(USAGE);
    kind.push(args[i + 1]);
  }
  const shard = shards.length && /^([1-9]\d*)\/([1-9]\d*)$/.exec(shards[0]);
  if (shards.length > 1 || (shards.length && !(shard && +shard[1] <= +shard[2]))) throw new Error(USAGE);
  const normal = (file) => file.replace(/\\/g, '/').replace(/^\.\//, '');
  const chosen = mutations.filter((m, i) => (!files.length || files.some((file) => normal(file) === m.file))
    && (!expects.length || expects.some((text) => m.expect.includes(text)))
    && (!shard || i % shard[2] === shard[1] - 1));
  const filter = [...files.map((file) => `--file ${file}`), ...expects.map((text) => `--expect ${text}`),
    ...shards.map((text) => `--shard ${text}`)].join(' ');
  if (filter && !chosen.length) throw new Error(`no mutation matches ${filter}`);
  return { chosen, filter };
}

/** A patch text must match its file exactly once, or the mutation is not the experiment written. */
function patchProblem(src, m) {
  const hits = src.split(m.from).length - 1;
  if (hits === 0) return `MUTATION MISS   ${m.why}\n                patch text not found in ${m.file}`;
  if (hits > 1) return `MUTATION AMBIG  ${m.why}\n                patch text matches ${hits} times in ${m.file}`;
  return null;
}

async function main(args = process.argv.slice(2), { mutations = MUTATIONS, root = ROOT } = {}) {
  // A filter is checked before anything is copied.
  const { chosen, filter } = selectMutations(args, mutations);
  const timeoutMs = suiteDeadline();
  await sweepStaleRuns();
  // The runner's pid names the root, so a later run can tell when it was stopped.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${RUN_PREFIX}${process.pid}-`));
  const evidence = path.join(tmp, 'infrastructure');
  let escaped = 0, misnamed = 0, passed = 0, invalid = 0, infrastructure = 0;

  try {
    // The control. If the suite is not green to begin with, nothing below means
    // anything -- a mutation cannot be blamed for a failure that was already there.
    const control = path.join(tmp, 'control');
    const bytes = copyDir(root, control, true);
    fs.mkdirSync(path.join(control, SUITE_TEMP));
    const per = (bytes / 1048576).toFixed(2);
    // Report copy volume because the same source is copied for every mutation.
    console.log(`copy     ${per} MB per mutation, ${((bytes * (chosen.length + 1)) / 1048576).toFixed(0)} MB in all`);
    // A filtered run still checks every patch text, so a stale mutation elsewhere fails loudly.
    for (const m of mutations) {
      if (chosen.includes(m)) continue;
      const problem = patchProblem(fs.readFileSync(path.join(root, m.file), 'utf8'), m);
      if (problem) { console.log(problem); invalid++; }
    }
    const already = await runSuite(control, undefined, timeoutMs);
    if (already.failure) {
      console.error(`CONTROL INFRASTRUCTURE FAILURE.\n  ${infrastructureDetail(already)}`
        + `\n  kept in ${keepEvidence(path.join(evidence, 'control'), already)}`);
      return 2;
    }
    if (already.failed.length) {
      // A title alone cannot tell a regression from a bound that load broke: print what the assertion saw.
      console.error(`CONTROL IS NOT GREEN. Fix the suite before running this.\n${failedDetail(already, '  ')}`);
      return 2;
    }
    console.log(filter
      ? `control  ${chosen.length} of ${mutations.length} mutations selected by ${filter}, suite green before any of them\n`
      : `control  ${mutations.length} mutations, suite green before any of them\n`);

    // Indices stay those of the whole list, so evidence paths match a full run's.
    for (const [i, m] of mutations.entries()) {
      if (!chosen.includes(m)) continue;
      const dir = path.join(tmp, `m${i}`);
      copyDir(root, dir, true);
      fs.mkdirSync(path.join(dir, SUITE_TEMP));
      const file = path.join(dir, m.file);
      const src = fs.readFileSync(file, 'utf8');

      const problem = patchProblem(src, m);
      if (problem) {
        console.log(problem);
        invalid++;
      } else {
        fs.writeFileSync(file, src.replace(m.from, m.to));
        const { verdict, text } = await judgeMutation(dir, m, path.join(evidence, `m${i}`), timeoutMs);
        console.log(text);
        if (verdict === 'infra') infrastructure++;
        else if (verdict === 'escaped') escaped++;
        else if (verdict === 'misnamed') misnamed++;
        else passed++;
      }
      // Hold at most one mutated copy: its verdict is printed and any evidence
      // is kept outside it. A copy that cannot be removed is reported.
      try { await removeCopy(dir); } catch (error) {
        console.log(`INFRA           copy ${dir} could not be removed\n                ${error.message}`);
        infrastructure++;
      }
    }
  } finally {
    // Remove every copy; the run's temp root stays only to hold kept evidence.
    for (const entry of fs.readdirSync(tmp)) if (entry !== 'infrastructure') await removeCopy(path.join(tmp, entry));
    if (!fs.existsSync(evidence)) await removeCopy(tmp);
  }

  const counts = `${passed} caught  ${escaped} escaped  ${misnamed} misnamed  ${invalid} invalid  ${infrastructure} infrastructure`;
  // A partial run never prints the full run's summary.
  console.log(filter ? `\npartial run, ${chosen.length} of ${mutations.length} mutations by ${filter}: ${counts}` : `\n${counts}`);
  if (fs.existsSync(evidence)) console.log(`infrastructure evidence kept in ${evidence}`);
  return escaped + misnamed + invalid + infrastructure === 0 ? 0 : 1;
}

if (require.main === module) main().then((code) => { process.exitCode = code; }, (error) => {
  console.error(error.message);
  process.exitCode = 2;
});
module.exports = {
  runSuite, mutationVerdict, terminateSuite, removeCopy, judgeMutation, selectMutations, main, RUN_PREFIX, SUITE_TEMP, COPIED,
};
