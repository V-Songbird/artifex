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
    why: 'a film missing frames passes its file check',
    file: 'core/film.js',
    from: '  if (v.samples !== expected.frames) {',
    to: '  if (false) {',
    expect: 'the film check refuses a file that disagrees with its frame grid, and says how',
  },
  {
    why: 'a soundtrack far shorter than its film passes the file check',
    file: 'core/film.js',
    from: '    if (heard < seconds - grain || heard > seconds + 2 * grain) {',
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
    why: 'frames are stamped by the wall clock instead of their place on the frame grid',
    file: 'core/film.js',
    from: 'timestamp: Math.round((i * 1e6) / hz), duration: Math.round(1e6 / hz),',
    to: 'timestamp: Math.round(now() * 1000), duration: Math.round(1e6 / hz),',
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
    why: 'the dOps fields keep the OpusHead byte order, so a decoder reads another pre-skip, rate and gain',
    file: 'core/film.js',
    from: 'u16(le.getUint16(10, true)), u32(le.getUint32(12, true)), u16(le.getInt16(16, true))',
    to: 'u16(le.getUint16(10)), u32(le.getUint32(12)), u16(le.getInt16(16))',
    expect: 'the dOps box is the OpusHead in big-endian, with its pre-skip and channel mapping kept',
  },
  {
    why: 'the pre-skip is dropped, so a decoder plays the encoder warming up as the start of the soundtrack',
    file: 'core/film.js',
    from: 'u16(le.getUint16(10, true))',
    to: 'u16(0)',
    expect: 'the dOps box is the OpusHead in big-endian, with its pre-skip and channel mapping kept',
  },
  {
    why: 'the file check counts the pre-skip as heard sound',
    file: 'core/film.js',
    from: ' - (opus ? opus.preSkip / 48000 : 0);',
    to: ';',
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

];

// Copy only what `node --test tests/*.test.js` reads: the tests, their modules
// under `core/`, `examples/` and `tools/`, and `package.json`. Keeping an explicit
// allowlist prevents unrelated workspace data from increasing every copy.
//
// If a test ever reads something new, the control run goes red before any
// mutation is applied and says so by name. That is the failure announcing
// itself, which is the point.
//
// The names are the tree root's own, so the filter applies there and nowhere
// else: once inside `core/`, every file is taken.
const COPIED = new Set(['core', 'examples', 'tests', 'tools', 'package.json']);

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
      else if (indent === diagnostic.indent) {
        const type = /^type: ['"]?(test|suite)['"]?$/.exec(text);
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
      const node = { indent, name: point[3], ok: point[1] === 'ok', directive: point[4], type: 'test' };
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
  const failed = tree.nodes.filter((node) => !node.ok && !node.directive).map((node) => node.name);
  if (summary.tests < 1 || summary.pass + summary.fail < 1 || summary.cancelled !== 0
      || Object.keys(counts).some((key) => counts[key] !== summary[key])
      || (summary.fail > 0) !== (failed.length > 0)) {
    return { failure: 'incomplete or inconsistent TAP test counts' };
  }
  return { failed, names: tree.nodes.map((node) => node.name), summary };
}

function suiteDeadline(value = process.env.ARTIFEX_NEGATIVE_TIMEOUT_MS) {
  if (value === undefined) return 300000;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) {
    throw new RangeError('ARTIFEX_NEGATIVE_TIMEOUT_MS must be an integer from 1 to 2147483647');
  }
  return timeout;
}

/** Terminate only this child's Windows tree or its private POSIX process group. */
function terminateSuite(child) {
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); return Promise.resolve(null); }
    catch (error) { return Promise.resolve(error.code === 'ESRCH' ? null : error); }
  }
  return new Promise((resolve) => {
    let detail = '';
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, killSignal: 'SIGKILL',
    });
    for (const stream of [killer.stdout, killer.stderr]) stream.on('data', (chunk) => {
      detail = (detail + chunk.toString('utf8')).slice(-2000);
    });
    killer.once('error', resolve);
    killer.once('close', (code) => resolve(code === 0 ? null : new Error(`owned tree termination exited ${code}: ${detail.trim()}`)));
  });
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
        terminationError ||= new Error('owned subprocess did not close within the 10-second teardown limit');
        try { child.kill('SIGKILL'); } catch (failure) { terminationError = failure; }
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish();
      }, 10000);
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

async function main() {
  const timeoutMs = suiteDeadline();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-negative-'));
  let escaped = 0, misnamed = 0, passed = 0, invalid = 0, infrastructure = 0;

  try {
    // The control. If the suite is not green to begin with, nothing below means
    // anything -- a mutation cannot be blamed for a failure that was already there.
    const control = path.join(tmp, 'control');
    const bytes = copyDir(ROOT, control, true);
    const per = (bytes / 1048576).toFixed(2);
    // Report copy volume because the same source is copied for every mutation.
    console.log(`copy     ${per} MB per mutation, ${((bytes * (MUTATIONS.length + 1)) / 1048576).toFixed(0)} MB in all`);
    const already = await runSuite(control, undefined, timeoutMs);
    if (already.failure) {
      console.error(`CONTROL INFRASTRUCTURE FAILURE.\n  ${infrastructureDetail(already)}`);
      return 2;
    }
    if (already.failed.length) {
      console.error('CONTROL IS NOT GREEN. Fix the suite before running this.');
      for (const t of already.failed) console.error(`  ${t}`);
      return 2;
    }
    console.log(`control  ${MUTATIONS.length} mutations, suite green before any of them\n`);

    for (const [i, m] of MUTATIONS.entries()) {
      const dir = path.join(tmp, `m${i}`);
      copyDir(ROOT, dir, true);
      const file = path.join(dir, m.file);
      const src = fs.readFileSync(file, 'utf8');

      const hits = src.split(m.from).length - 1;
      if (hits === 0) { console.log(`MUTATION MISS   ${m.why}\n                patch text not found in ${m.file}`); invalid++; continue; }
      if (hits > 1) { console.log(`MUTATION AMBIG  ${m.why}\n                patch text matches ${hits} times in ${m.file}`); invalid++; continue; }

      fs.writeFileSync(file, src.replace(m.from, m.to));
      const result = await runSuite(dir, undefined, timeoutMs);
      const verdict = mutationVerdict(result, m.expect);

      if (verdict === 'infra') {
        console.log(`INFRA           ${m.why}\n                ${infrastructureDetail(result)}`);
        infrastructure++;
      } else if (verdict === 'escaped') {
        console.log(`ESCAPED         ${m.why}\n                nothing failed; no check covers this`);
        escaped++;
      } else if (verdict === 'misnamed') {
        console.log(`MISNAMED        ${m.why}\n                expected: ${m.expect}\n                failed:   ${result.failed.join(' | ')}`);
        misnamed++;
      } else {
        console.log(`ok              ${m.why}`);
        passed++;
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${passed} caught  ${escaped} escaped  ${misnamed} misnamed  ${invalid} invalid  ${infrastructure} infrastructure`);
  return escaped + misnamed + invalid + infrastructure === 0 ? 0 : 1;
}

if (require.main === module) main().then((code) => { process.exitCode = code; }, (error) => {
  console.error(error.message);
  process.exitCode = 2;
});
module.exports = { runSuite, mutationVerdict };
