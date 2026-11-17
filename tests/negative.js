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
//
// The control runs the whole suite; each mutation then runs only the test file
// that holds its expected test, and the whole suite again only when that file
// does not catch it, so an escape or a misnamed catch is judged as before.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');

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
    why: 'the vector surface keeps a blend mode its paths do not carry, so the SVG differs from its raster in silence',
    file: 'core/surface-vector.js',
    from: "    take: (v) => v === 'source-over',",
    to: '    take: () => true,',
    expect: 'a composite or blend mode refuses BY NAME, and source-over is taken',
  },
  {
    why: 'the vector surface keeps a filter its paths do not carry',
    file: 'core/surface-vector.js',
    from: "    take: (v) => v === 'none',",
    to: '    take: () => true,',
    expect: 'a filter refuses BY NAME, and none is taken',
  },
  {
    why: 'the vector surface keeps a shadow blur its paths do not carry',
    file: 'core/surface-vector.js',
    from: '    take: (v) => !(Number(v) > 0 && Number(v) < Infinity),',
    to: '    take: () => true,',
    expect: 'a shadow blur refuses BY NAME, and zero is taken',
  },
  {
    why: 'the vector surface keeps a horizontal shadow offset its paths do not carry',
    file: 'core/surface-vector.js',
    from: '  shadowOffsetX: {\n    initial: 0,\n    take: (v) => !(Number.isFinite(Number(v)) && Number(v) !== 0),',
    to: '  shadowOffsetX: {\n    initial: 0,\n    take: () => true,',
    expect: 'a horizontal shadow offset refuses BY NAME, and zero is taken',
  },
  {
    why: 'the vector surface keeps a vertical shadow offset its paths do not carry',
    file: 'core/surface-vector.js',
    from: '  shadowOffsetY: {\n    initial: 0,\n    take: (v) => !(Number.isFinite(Number(v)) && Number(v) !== 0),',
    to: '  shadowOffsetY: {\n    initial: 0,\n    take: () => true,',
    expect: 'a vertical shadow offset refuses BY NAME, and zero is taken',
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
    why: 'the stroke font names no character it lacks, so a piece cannot refuse a string that would lose one',
    file: 'core/stroke-font.js',
    from: "  return [...new Set(str)].filter((ch) => ch !== ' ' && glyph(ch, opts).length === 0);",
    to: '  return [...new Set(str)].filter(() => false);',
    expect: 'the stroke font names each character of a string it has no glyph for',
  },
  {
    why: 'a crack rises in 2 ms again, a click: its first 4 ms hold over half of its first 30, where the steps of the owner\'s reference recording rise over 5 to 16 ms',
    file: 'examples/stride.js',
    from: '        { from: 0, rise: 0.005, length: 0.03 + 0.012 * R(\'fall\', \'roll\', i), colour, band: 2.8, level: crack },',
    to: '        { from: 0, rise: 0.002, length: 0.03 + 0.012 * R(\'fall\', \'roll\', i), colour, band: 2.8, level: crack },',
    expect: 'stride: a step on hard ground is a dry crack and a brief rasp whose bands read as noise, so its film replays',
  },
  {
    why: 'a plant under a planted foot\'s ball rises with the heel again, so it springs back from a slight press, not its deepest',
    file: 'examples/stride.js',
    from: '              press = Math.max(press, pinned ? pin[j][1] : 0);',
    to: '              press = Math.max(press, 0);',
    expect: 'stride: every plant keeps one side of the walker, a foot flattens the plant under it, pins it under the ball until the toe leaves, and it springs back, and each first touch rustles under the air',
  },
  {
    why: 'a stalk or shrub rooted just in front of the ground line is turned to grass again, so that band holds none',
    file: 'examples/stride.js',
    from: '        const kind = roll < 0.6 ? \'grass\' : roll < 0.76 ? \'stalk\' : roll < 0.9 ? \'shrub\' : \'bloom\';',
    to: '        const kind = roll < 0.6 || (y >= GY + SOLE && y < GY + 20 && roll < 0.9) ? \'grass\' : roll < 0.76 ? \'stalk\' : roll < 0.9 ? \'shrub\' : \'bloom\';',
    expect: 'stride: the background lives and changes with the seed: birds far off, plants of four kinds, trees on both ridges',
  },
  {
    why: 'a plant rooted between the sole\'s underside and 18 under the ground line is painted behind the walker again, so its stem shows under the sole and vanishes into it',
    file: 'examples/stride.js',
    from: '    plants(g, s, f, cam, (t) => t.y < GY + SOLE);\n    figure(g, pose, null);\n    plants(g, s, f, cam, (t) => t.y >= GY + SOLE);',
    to: '    plants(g, s, f, cam, (t) => t.y < GY + 18);\n    figure(g, pose, null);\n    plants(g, s, f, cam, (t) => t.y >= GY + 18);',
    expect: 'stride: every plant keeps one side of the walker, a foot flattens the plant under it, pins it under the ball until the toe leaves, and it springs back, and each first touch rustles under the air',
  },
  {
    why: 'a pressed plant follows the foot\'s press with no spring, so it stands up the frame the foot leaves',
    file: 'examples/stride.js',
    from: '        t.press = release(raw, 2.4, 0.35);',
    to: '        t.press = raw;',
    expect: 'stride: every plant keeps one side of the walker, a foot flattens the plant under it, pins it under the ball until the toe leaves, and it springs back, and each first touch rustles under the air',
  },
  {
    why: 'a foot touching a plant makes no sound again',
    file: 'examples/stride.js',
    from: 'const RUSTLE = 0.006;',
    to: 'const RUSTLE = 0;',
    expect: 'stride: every plant keeps one side of the walker, a foot flattens the plant under it, pins it under the ball until the toe leaves, and it springs back, and each first touch rustles under the air',
  },
  {
    why: 'a scuff drags on as a long scrape instead of a rasp of 80 ms at most',
    file: 'examples/stride.js',
    from: "length: 0.04 + 0.025 * R('fall', 'scuff', i),",
    to: "length: 0.4 + 0.025 * R('fall', 'scuff', i),",
    expect: 'stride: a step on hard ground is a dry crack and a brief rasp whose bands read as noise, so its film replays',
  },
  {
    why: 'a scuff is noise through a band too narrow to read as noise, a ringing tone AAC codes as one',
    file: 'examples/stride.js',
    from: "'scuff colour', i) - 0.5)), band: 1.8, rough: 0.6,",
    to: "'scuff colour', i) - 0.5)), band: 0.05, rough: 0.6,",
    expect: 'stride: a step on hard ground is a dry crack and a brief rasp whose bands read as noise, so its film replays',
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
  {
    why: 'every hit of cues\' motion sounds a frame after the picture shows its cause',
    file: 'examples/cues.js',
    from: '        hits.push({ name, part, frame: film[scene].start + f, velocity });',
    to: '        hits.push({ name, part, frame: film[scene].start + f + 1, velocity });',
    expect: 'cues: the motion sounds on the frames that show it, as hard as its cue, no two hits alike',
  },
  {
    why: 'every hit of cues\' motion lands at full force, whatever the size of its bump',
    file: 'examples/cues.js',
    from: '        hits.push({ name, part, frame: film[scene].start + f, velocity });',
    to: '        hits.push({ name, part, frame: film[scene].start + f, velocity: 1 });',
    expect: 'cues: the motion sounds on the frames that show it, as hard as its cue, no two hits alike',
  },
  {
    why: 'cues\' settle sounds on its move\'s last frame, after the picture already shows the disc at rest',
    file: 'examples/cues.js',
    from: '      hit(\'settle\', \'disc\', 3, still - film[3].start, 0.35);',
    to: '      hit(\'settle\', \'disc\', 3, 36, 0.35);',
    expect: 'cues: the motion sounds on the frames that show it, as hard as its cue, no two hits alike',
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

  // --- sprites ----------------------------------------------------------------
  {
    why: 'a sprite baked at one device scale is drawn at another',
    file: 'core/layer.js',
    from: "    const id = `${name}@${res}:${box.join(',')}`;",
    to: "    const id = `${name}:${box.join(',')}`;",
    expect: 'each device scale keeps its own sprite copy',
  },
  {
    why: "a sprite's bake scale is ignored, so an enlarged sprite is resampled up",
    file: 'core/layer.js',
    from: '  const res = m && Math.round(Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * 2 ** 20) / 2 ** 20 * scale;',
    to: '  const res = m && Math.round(Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * 2 ** 20) / 2 ** 20;',
    expect: 'a sprite baked at a larger scale holds that many more pixels and is drawn back at size',
  },
  {
    why: 'a sprite takes any bake scale, so one call can ask for a canvas past any memory',
    file: 'core/layer.js',
    from: '  if (!(scale > 0 && scale <= MAX_SCALE)) throw',
    to: '  if (!(scale > 0)) throw',
    expect: 'a sprite baked at a larger scale holds that many more pixels and is drawn back at size',
  },
  {
    why: 'a sprite bounds each side of its bake instead of its area, so a canvas Edge leaves blank is made',
    file: 'core/layer.js',
    from: '  if (raster && !(pw * ph <= MAX_BAKE)) throw',
    to: '  if (raster && !(pw <= MAX_BAKE && ph <= MAX_BAKE)) throw',
    expect: 'a sprite refuses a bake past MAX_BAKE pixels by name, before making its canvas',
  },
  {
    why: "a sprite is drawn at the caller's smoothing quality, so a shrunk texture shimmers",
    file: 'core/layer.js',
    from: '    if (smoothing) g.imageSmoothingQuality = smoothing;\n',
    to: '',
    expect: 'a sprite is drawn at its own smoothing, high by default, whatever the caller set',
  },
  {
    why: 'a sprite without a smoothing is drawn at medium quality, not high',
    file: 'core/layer.js',
    from: "budget = BUDGET, smoothing = 'high' } = opt;",
    to: "budget = BUDGET, smoothing = 'medium' } = opt;",
    expect: 'a sprite is drawn at its own smoothing, high by default, whatever the caller set',
  },
  {
    why: 'a sprite that asks for medium or low quality is drawn at high',
    file: 'core/layer.js',
    from: '    if (smoothing) g.imageSmoothingQuality = smoothing;',
    to: "    if (smoothing) g.imageSmoothingQuality = 'high';",
    expect: 'a sprite is drawn at its own smoothing, high by default, whatever the caller set',
  },
  {
    why: 'a sprite that turns smoothing off is still smoothed, so pixel art blurs',
    file: 'core/layer.js',
    from: '    g.imageSmoothingEnabled = smoothing !== false;',
    to: '    g.imageSmoothingEnabled = true;',
    expect: 'a sprite is drawn at its own smoothing, high by default, whatever the caller set',
  },
  {
    why: 'a sprite takes any string as its smoothing, which the canvas ignores without a word',
    file: 'core/layer.js',
    from: "  if (smoothing !== false && !['high', 'medium', 'low'].includes(smoothing)) {",
    to: "  if (smoothing !== false && typeof smoothing !== 'string') {",
    expect: 'a sprite refuses a paint, key, box, transform or smoothing it cannot use, by name',
  },
  {
    why: 'each smoothing bakes its own copy of the same picture',
    file: 'core/layer.js',
    from: "    const id = `${name}@${res}:${box.join(',')}`;",
    to: "    const id = `${name}@${res}:${box.join(',')}:${smoothing}`;",
    expect: 'a sprite shares its copy between smoothings',
  },
  {
    why: 'a turned surface gives a scale a hair off on some frames, so sprites are baked again',
    file: 'core/layer.js',
    from: '  const res = m && Math.round(Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * 2 ** 20) / 2 ** 20 * scale;',
    to: '  const res = m && Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * scale;',
    expect: 'a sprite on a turning surface is baked once',
  },
  {
    why: 'every sprite copy is baked whole, never grown from an older one',
    file: 'core/layer.js',
    from: '      for (const k of copies.keys()) if (k < key && (from === null || k > from)) from = k;',
    to: '      for (const k of copies.keys()) if (false && k < key && (from === null || k > from)) from = k;',
    expect: 'a keyed sprite grows each copy from the nearest older one',
  },
  {
    why: 'a grown copy is painted from its own key, so the marks between are lost',
    file: 'core/layer.js',
    from: '  paint(cg, state, from, to);',
    to: '  paint(cg, state, from === null ? null : to, to);',
    expect: 'a keyed sprite grows each copy from the nearest older one',
  },
  {
    why: 'a grown copy is made on a new canvas copied from the older one, so a growing sheet makes a canvas per key',
    file: 'core/layer.js',
    from: '      copy = bake(g, older || sibling(g.canvas, pw, ph), state, box, res, paint, from, key);',
    to: "      const fresh = sibling(g.canvas, pw, ph);\n      if (older) fresh.getContext('2d').drawImage(older, 0, 0);\n      copy = bake(g, fresh, state, box, res, paint, from, key);",
    expect: 'a keyed sprite grows one canvas in place, and an older key drawn again is baked again',
  },
  {
    why: 'a copy grown in place is still kept at its older key, so drawing that key again shows the marks after it',
    file: 'core/layer.js',
    from: '        copies.delete(from);\n',
    to: '',
    expect: 'a keyed sprite grows one canvas in place, and an older key drawn again is baked again',
  },
  {
    why: 'a copy grown in place is counted again at its new key, so held() and the budget see one canvas as many',
    file: 'core/layer.js',
    from: '        cache.pixels -= pw * ph;\n',
    to: '',
    expect: 'a keyed sprite grows one canvas in place, and an older key drawn again is baked again',
  },
  {
    why: 'a span grown in place starts from the drawing state the paint before it left',
    file: 'core/layer.js',
    from: '    cg.restore();\n',
    to: '',
    expect: 'a sprite grown in place paints each span from the default drawing state',
  },
  {
    why: 'a span grown in place starts with the path the paint before it left, so its fill paints the older marks again',
    file: 'core/layer.js',
    from: '  cg.beginPath();\n',
    to: '',
    expect: 'a sprite grown in place starts each span with an empty path',
  },
  {
    why: 'a copy leaves the cache only once it has grown, so a paint that throws leaves it half-grown at its older key',
    file: 'core/layer.js',
    from: '      copy = bake(g, older || sibling(g.canvas, pw, ph), state, box, res, paint, from, key);\n',
    to: '      if (older) { copies.set(from, older); cache.recent.set(older, { copies, key: from }); cache.pixels += pw * ph; }\n'
      + '      copy = bake(g, older || sibling(g.canvas, pw, ph), state, box, res, paint, from, key);\n'
      + '      if (older) { copies.delete(from); cache.recent.delete(older); cache.pixels -= pw * ph; }\n',
    expect: 'a sprite whose paint throws as it grows keeps no half-grown copy',
  },
  {
    why: 'sprite copies are kept past their budget',
    file: 'core/layer.js',
    from: '          if (cache.pixels + pw * ph <= budget) break;',
    to: '          break;',
    expect: 'sprite copies stay within their budget, dropping the least recently drawn',
  },
  {
    why: 'a budget of 0 still keeps a copy',
    file: 'core/layer.js',
    from: '      if (pw * ph <= budget) {',
    to: '      if (pw * ph <= budget || budget === 0) {',
    expect: 'sprite copies stay within their budget, dropping the least recently drawn',
  },
  {
    why: 'drawing a copy does not make it recent, so the budget drops the copy in use',
    file: 'core/layer.js',
    from: '    if (copies.get(key) === copy) {\n      cache.recent.delete(copy);',
    to: '    if (copies.get(key) === copy && !cache.recent.has(copy)) {\n      cache.recent.delete(copy);',
    expect: 'sprite copies stay within their budget, dropping the least recently drawn',
  },
  {
    why: 'a new solve draws the copies of the solve before it',
    file: 'core/layer.js',
    from: '    if (!cache || cache.state !== state) sprites.set(',
    to: '    if (!cache) sprites.set(',
    expect: 'a sprite copy belongs to its canvas and its solve',
  },
  {
    why: 'a sprite is drawn without its transform',
    file: 'core/layer.js',
    from: '    g.transform(...at);',
    to: '    if (!raster) g.transform(...at);',
    expect: 'a sprite is drawn with any transform exactly as baking it afresh draws it',
  },
  {
    why: 'an SVG draws a sprite without its transform',
    file: 'core/layer.js',
    from: '    g.transform(...at);',
    to: '    if (raster) g.transform(...at);',
    expect: 'vector and null surfaces paint a sprite directly under its transform',
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
    why: 'a flicker deep enough to flash the whole frame is accepted',
    file: 'core/finish.js',
    from: 'v.flicker <= FLICKER',
    to: 'v.flicker <= 1',
    expect: 'the deepest flicker cannot flash any picture',
  },
  {
    why: 'the flicker cap lets a saturated red frame dip by more than a red flash needs',
    file: 'core/finish.js',
    from: 'const FLICKER = 0.025;',
    to: 'const FLICKER = 0.03;',
    expect: 'the deepest flicker cannot flash any picture',
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
    why: 'a bloom past 1, or not a number, is accepted',
    file: 'core/finish.js',
    from: "  for (const k of ['grain', 'vignette', 'bloom', 'halation']) {",
    to: "  for (const k of ['grain', 'vignette', 'halation']) {",
    expect: 'a finish is validated by name',
  },
  {
    why: 'every finish reads the frame back for a bloom, declared or not',
    file: 'core/finish.js',
    from: '    if (f.bloom || f.halation) bloom(g, f, s, w, h);',
    to: '    bloom(g, { bloom: f.bloom || 0, halation: f.halation || 0 }, s, w, h);',
    expect: 'a finish without bloom reads no pixels',
  },
  {
    why: "the bloom is taken after the grain, so the grain's boil reaches its knee",
    file: 'core/finish.js',
    from: "    if (f.bloom || f.halation) bloom(g, f, s, w, h);\n    if (f.grain) {\n      if (!s.tile) s.tile = tile(g, s.R);\n      const k = (f.grainSize || 1) * Math.min(w, h) / STOCK;\n      const ox = Math.floor(s.R('finish grain', 'x', frame) * TILE);\n      const oy = Math.floor(s.R('finish grain', 'y', frame) * TILE);\n      g.save();\n      g.scale(k, k);\n      g.translate(-ox, -oy);\n      pass('soft-light', f.grain, g.createPattern(s.tile, 'repeat'), ox, oy, w / k, h / k);\n      g.restore();\n    }\n",
    to: "    if (f.grain) {\n      if (!s.tile) s.tile = tile(g, s.R);\n      const k = (f.grainSize || 1) * Math.min(w, h) / STOCK;\n      const ox = Math.floor(s.R('finish grain', 'x', frame) * TILE);\n      const oy = Math.floor(s.R('finish grain', 'y', frame) * TILE);\n      g.save();\n      g.scale(k, k);\n      g.translate(-ox, -oy);\n      pass('soft-light', f.grain, g.createPattern(s.tile, 'repeat'), ox, oy, w / k, h / k);\n      g.restore();\n    }\n    if (f.bloom || f.halation) bloom(g, f, s, w, h);\n",
    expect: 'the bloom comes first: its glow added over the whole frame before the grain',
  },
  {
    why: 'the frame is read for the bloom from a canvas not kept for reading, so each read is a slow one',
    file: 'core/finish.js',
    from: "  const t = b.half.getContext('2d', { willReadFrequently: true });",
    to: "  const t = b.half.getContext('2d');",
    expect: 'the bloom comes first: its glow added over the whole frame before the grain',
  },
  {
    why: 'the bloom keeps its first canvases, so a frame at another scale is read at the old size',
    file: 'core/finish.js',
    from: '  if (!b || b.half.width !== hw || b.half.height !== hh || b.copy.width !== cw || b.copy.height !== ch) {',
    to: '  if (!b) {',
    expect: 'the bloom is the same share of the frame at any scale',
  },
  {
    why: 'a surface that cannot make a canvas fails the bloom with no name',
    file: 'core/finish.js',
    from: "    if (!half || !copy) throw new Error(`finish: this surface has a canvas but no way to make another, so its ${f.bloom ? 'bloom' : 'halation'} cannot be drawn`);\n",
    to: '',
    expect: 'a surface that cannot make a canvas refuses the bloom by name',
  },
  {
    why: 'a frame read smaller than the bloom copy leaves copy pixels with nothing to average',
    file: 'core/finish.js',
    from: '  const block = (i, n, of) => [Math.floor((i * n) / of), Math.max(Math.floor((i * n) / of) + 1, Math.floor(((i + 1) * n) / of))];',
    to: '  const block = (i, n, of) => [Math.floor((i * n) / of), Math.floor(((i + 1) * n) / of)];',
    expect: 'the bloom is the same share of the frame at any scale',
  },
  {
    why: 'light below the bloom knee counts against the glow',
    file: 'core/finish.js',
    from: '  if (L <= KNEE) return 0;\n',
    to: '',
    expect: 'the bloom keeps only the light above its knee, growing from nothing at the knee',
  },
  {
    why: 'the bloom knee is a hard threshold, so a light brightening past it pops its glow on',
    file: 'core/finish.js',
    from: '  return (a * (L - KNEE)) / (255 - KNEE);',
    to: '  return 1;',
    expect: 'the bloom keeps only the light above its knee, growing from nothing at the knee',
  },
  {
    why: 'the bloom blurs across only, so its glow is a streak',
    file: 'core/finish.js',
    from: '  const down = blur(across, cw, ch, false);',
    to: '  const down = across;',
    expect: "the bloom spreads light evenly: round, and out to the frame's edges",
  },
  {
    why: "the bloom's blur reads past the copy's edges instead of holding the edge sample",
    file: 'core/finish.js',
    from: '        const q = o + step * Math.min(len - 1, Math.max(0, i + j));',
    to: '        const q = o + step * (i + j);',
    expect: "the bloom spreads light evenly: round, and out to the frame's edges",
  },
  {
    why: 'a grade reads the frame back whatever it declares, so a grade of black, white and tone alone pays for a pixel pass',
    file: 'core/finish.js',
    from: '    if (d && [...CHANNELS, ...TONES].some((k) => k in d)) print(g, d, s, w, h);',
    to: '    if (d) print(g, d, s, w, h);',
    expect: 'a finish without bloom reads no pixels',
  },
  {
    why: 'the graded frame is laid over the frame instead of replacing it, so a translucent pixel takes its old colour too',
    file: 'core/finish.js',
    from: "  g.globalCompositeOperation = 'copy';\n  g.globalAlpha = 1;",
    to: "  g.globalCompositeOperation = 'source-over';\n  g.globalAlpha = 1;",
    expect: 'the grade curves and tints the frame read 1:1, between its tone and its ends',
  },
  {
    why: 'the grade reads the frame from a canvas not kept for reading, so each read is a slow one',
    file: 'core/finish.js',
    from: "  const t = s.print.getContext('2d', { willReadFrequently: true });",
    to: "  const t = s.print.getContext('2d', {});",
    expect: 'the grade curves and tints the frame read 1:1, between its tone and its ends',
  },
  {
    why: 'the grade is drawn back in design units, so at a fractional scale its \'copy\' half clears the frame\'s last row and column',
    file: 'core/finish.js',
    from: '  g.setTransform(1, 0, 0, 1, 0, 0);\n  g.beginPath();\n  g.rect(x, y, pw, ph);',
    to: '  g.beginPath();\n  g.rect(0, 0, w, h);',
    expect: 'the grade reads and draws back whole pixels at a scale that does not divide the frame',
  },
  {
    why: 'the grade reads the frame through its unrounded extent, so at a fractional scale the copy is resampled, not 1:1',
    file: 'core/finish.js',
    from: '  t.drawImage(g.canvas, x, y, pw, ph, 0, 0, pw, ph);',
    to: '  t.drawImage(g.canvas, m.e, m.f, w * m.a, h * m.d, 0, 0, pw, ph);',
    expect: 'the grade reads and draws back whole pixels at a scale that does not divide the frame',
  },
  {
    why: 'a tone curve takes the mean of its two spans as its middle slope, so a mid near either end overshoots and turns back',
    file: 'core/finish.js',
    from: '  const s0 = 2 * mid, s1 = 2 * (1 - mid), sm = s0 * s1;',
    to: '  const s0 = 2 * mid, s1 = 2 * (1 - mid), sm = 1;',
    expect: 'a tone curve is straight at its defaults, never turns back, and lands its ends',
  },
  {
    why: 'a tone curve ignores its toe',
    file: 'core/finish.js',
    from: '    ? span((2 * v) / 255, 0, mid, s0 * (1 - toe), sm)',
    to: '    ? span((2 * v) / 255, 0, mid, s0, sm)',
    expect: 'a tone curve is straight at its defaults, never turns back, and lands its ends',
  },
  {
    why: 'a curve whose middle sits on black or white is accepted',
    file: 'core/finish.js',
    from: "    if ('mid' in c && !(unit(c.mid) && c.mid > 0 && c.mid < 1))",
    to: "    if ('mid' in c && !unit(c.mid))",
    expect: 'a finish is validated by name',
  },
  {
    why: 'a split tint adds its whole colour, so it lightens the shadows and highlights it tints',
    file: 'core/finish.js',
    from: '    return (l, q) => amount * weigh(l / 255) * (c[q] - Y);',
    to: '    return (l, q) => amount * weigh(l / 255) * c[q];',
    expect: 'split tints change the hue of shadows and highlights, not their lightness',
  },
  {
    why: 'the halation keeps what the blur takes from the light too, so it lies over bright shapes and not only past their edges',
    file: 'core/finish.js',
    from: '    const rise = Math.max(0, Y(down, 3 * i, 256 * total) - Y(lit, 3 * i, 256));',
    to: '    const rise = Math.abs(Y(down, 3 * i, 256 * total) - Y(lit, 3 * i, 256));',
    expect: 'the halation fringes only past the edges of light above the bloom knee',
  },
  {
    why: 'a declared halation is read but never drawn',
    file: 'core/finish.js',
    from: '  if (f.halation) add(b.fringe, f.halation, fringe);\n',
    to: '',
    expect: 'the halation adds its fringe after the bloom, from the same read, leaving the glow as it was',
  },
  {
    why: 'a declared grain is never drawn',
    file: 'core/finish.js',
    from: '    if (f.grain) {',
    to: '    if (false) {',
    expect: 'film fixtures: drawFrame applies the finish\'s grain where a fixture declares it',
  },
  {
    why: 'a grade\'s toning is never drawn',
    file: 'core/finish.js',
    from: "    if (d && d.toning) pass('color', d.toning, d.tone);",
    to: '',
    expect: 'film fixtures: drawFrame applies the finish\'s grade toning where a fixture declares it',
  },
  {
    why: 'a grade\'s black and white are never drawn',
    file: 'core/finish.js',
    from: '    if (d && (d.black || d.white)) {',
    to: '    if (false) {',
    expect: 'film fixtures: drawFrame applies the finish\'s grade black and white where a fixture declares it',
  },
  {
    why: 'a declared flicker is never drawn',
    file: 'core/finish.js',
    from: '    if (f.flicker) pass(',
    to: '    if (false) pass(',
    expect: 'film fixtures: drawFrame applies the finish\'s flicker where a fixture declares it',
  },
  {
    why: 'a declared vignette is never drawn',
    file: 'core/finish.js',
    from: '    if (f.vignette) {',
    to: '    if (false) {',
    expect: 'film fixtures: drawFrame applies the finish\'s vignette where a fixture declares it',
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

  // --- images a piece draws over, from or after -------------------------------
  {
    why: 'an image whose base64 text holds the wrong number of bytes is accepted, so a reader runs past its pixels',
    file: 'core/image.js',
    from: '    if (holds !== n) return',
    to: '    if (false) return',
    expect: 'images are opt-in, and every malformed declaration is refused by name',
  },
  {
    why: 'the digest ignores the pixels, so a file drawn with another image names the same digest',
    file: 'core/image.js',
    from: '  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);',
    to: '  for (let i = 0; i < bytes.length; i++) h = Math.imul(h, 0x01000193);',
    expect: 'the manifest names every image by size, digest, source and rights, never its pixels, and a changed byte changes the digest',
  },
  {
    why: 'every solve shares one decoded buffer, so a build that changes it spoils the next solve',
    file: 'core/image.js',
    from: 'data: entry(img).data.slice(),',
    to: 'data: entry(img).data,',
    expect: 'a solve hands every build a fresh copy of each image, and only a piece that declares images has them',
  },
  {
    why: 'sample hands back blue, green, red, so every colour drawn from an image has red and blue swapped',
    file: 'core/image.js',
    from: '  return [at(0), at(1), at(2), n === 4 ? at(3) : 255];',
    to: '  return [at(2), at(1), at(0), n === 4 ? at(3) : 255];',
    expect: 'sample reads bilinearly between pixel centres, in R, G, B, A order, and holds the edge outside',
  },
  {
    why: 'replay skips the image comparison, so a file drawn with another image is redrawn as if it were this one',
    file: 'tools/replay.js',
    from: '  if (changed) throw new Error(`replay: ${changed}`);',
    to: '  if (false) throw new Error(`replay: ${changed}`);',
    expect: 'a file drawn with another image, or without one the piece declares, is refused naming the image',
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
    from: "  const examples = files('examples').filter((f) => f !== 'examples/index.js');",
    to: "  const examples = ['examples/drift.js'];",
    expect: 'the page builder refuses to write a bundle with a hole in it',
  },
  {
    why: 'a build failure disables the controls without a word to a screen reader',
    file: 'tools/build-page.js',
    from: '      <div role="alert" style="margin-top:10px">',
    to: '      <div style="margin-top:10px">',
    expect: 'the page markup names its controls, links each export to its note and announces errors',
  },
  {
    why: 'a parameter slider has no accessible name',
    file: 'tools/build-page.js',
    from: "    r.setAttribute('aria-label', k);",
    to: '',
    expect: 'sliders, the canvas and the build failure carry accessible names and a next step',
  },
  {
    why: 'a film that plays in bursts is saved, because every frame is there and the duration is right',
    file: 'core/export.js',
    from: '  if (Math.abs(v.medianGapMs - budget) > budget * 0.1 || v.p95GapMs > budget * 1.5 || v.maxGapMs > budget * 3) {',
    to: '  if (false) {',
    expect: 'a film with every frame and uneven spacing is refused, and so is one missing a frame',
  },
  {
    why: 'a complete single-frame film is rejected for having no spacing interval',
    file: 'core/export.js',
    from: '  if (expected === 1) return v;',
    to: '',
    expect: 'a single-frame film needs exactly one frame and no spacing interval',
  },
  {
    why: 'one long freeze is let through, because it moves neither the median nor the p95',
    file: 'core/export.js',
    from: ' || v.maxGapMs > budget * 3) {',
    to: ') {',
    expect: 'a film with every frame and uneven spacing is refused, and so is one missing a frame',
  },
  {
    why: 'a film missing pictures is saved as long as the ones it has are evenly spaced',
    file: 'core/export.js',
    from: '  if (v.frames !== expected) {',
    to: '  if (false) {',
    expect: 'a film with every frame and uneven spacing is refused, and so is one missing a frame',
  },
  {
    why: 'a block forgets which cluster it is in, so every cluster restarts the film at zero',
    file: 'core/export.js',
    from: '      out.push((cluster + ((uint(at, 2) << 16) >> 16)) * scale / 1000000);',
    to: '      out.push(((uint(at, 2) << 16) >> 16) * scale / 1000000);',
    expect: 'a film is read from the blocks its FILE holds, by walking it rather than scanning it',
  },
  {
    why: 'EBML sizes go back to marker plus value less the marker, which floating point rounds for 8-byte sizes',
    file: 'core/export.js',
    from: '  for (let i = 1; i < sizeLen; i++) { size = size * 256 + bytes[at + idLen + i]; unknown = unknown && bytes[at + idLen + i] === 0xFF; }',
    to: '  for (let i = 1; i < sizeLen; i++) { size = size * 256 + bytes[at + idLen + i]; unknown = unknown && bytes[at + idLen + i] === 0xFF; }\n  size = size + 2 ** (7 * sizeLen) - 2 ** (7 * sizeLen);',
    expect: 'every EBML size is read exactly, at every length up to 8 bytes',
  },
  {
    why: 'a saved WebM states its length in milliseconds whatever unit its file declares',
    file: 'core/export.js',
    from: '    const units = (seconds * 1e9) / scale;',
    to: '    const units = seconds * 1000;',
    expect: 'a recorded WebM is saved with its length, and every other byte as recorded',
  },
  {
    why: 'an added Duration leaves Info its old size, so a reader stops short of it',
    file: 'core/export.js',
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
    from: '    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,',
    to: '    0.0259040371 * l + 0.7827717662 * m - 0.8186757660 * s,',
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
  {
    why: 'the white term is dropped, so tone mapping never reaches white and the peak prints grey',
    file: 'core/colour.js',
    from: '  return x * (1 + x / (white * white)) / (1 + x);',
    to: '  return x / (1 + x);',
    expect: 'extended Reinhard lands white on 1 and keeps the low end nearly linear',
  },
  {
    why: 'empty cells count toward the average, so a sparse density is exposed as if it were dark',
    file: 'core/colour.js',
    from: '    if (!(v > 0)) continue;',
    to: '    if (!(v > 0)) { lit++; continue; }',
    expect: 'toneMap exposes from the average of lit cells and whitens at the peak, so nothing clips',
  },
  {
    why: 'highlights is read but the logarithm is kept, so the densest folds still clip to one tone',
    file: 'examples/attractor.js',
    from: '      const curve = h > 0 ? toneMap(cells) : null;',
    to: '      const curve = null;',
    expect: 'the attractor keeps its densest folds apart when highlights is raised, and moves nothing at 0',
  },

  // --- the depth armature ---------------------------------------------------
  {
    why: 'per-joint perspective scales every joint by the mean depth, so a part aimed at the lens keeps one width',
    file: 'core/armature.js',
    from: '  const kAt = (p) => (joint ? focal / (focal + dot(p, V) - cz) : k);',
    to: '  const kAt = (p) => (false ? focal / (focal + dot(p, V) - cz) : k);',
    expect: 'per-joint perspective widens the near end of a part aimed at the lens by the ratio of its depths',
  },
  {
    why: 'a joint-perspective section keeps the orthographic angle, so it lies askew on a converging segment',
    file: 'core/armature.js',
    from: '      const [qx, qy, ql] = joint && dl > 0 ? [d0, d1, dl] : [px, py, flat];',
    to: '      const [qx, qy, ql] = joint && dl > 0 ? [px, py, flat] : [px, py, flat];',
    expect: 'per-joint perspective widens the near end of a part aimed at the lens by the ratio of its depths',
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
  {
    why: 'the width profile is read by point count, so a swell slides to wherever the points bunch',
    file: 'core/path.js',
    from: '    const w = perPoint ? width[k] : width(run[i] / total);',
    to: '    const w = perPoint ? width[k] : width(i / (n - 1));',
    expect: 'outline takes its width from the length along the line, not from the point count',
  },
  {
    why: 'the inside of a sharp turn always cuts where its edges cross, so the outline spikes far past the stroke',
    file: 'core/path.js',
    from: '    return cut && !fold ? [cross] : [a1, c, b0];',
    to: '    return [cross];',
    expect: 'an outline covers its stroke at every corner, from a right angle to a reversal and a tight curl',
  },
  {
    why: 'a closed outline cuts every inside corner, so a band wider than its shape leaves the middle empty',
    file: 'core/path.js',
    from: '        joins[0] = corner(s, h, d, 1, side, miterLimit, true);',
    to: '        joins[0] = joins[0];',
    expect: 'a closed outline wider than its shape fills the middle too',
  },
  {
    why: 'an inside cut ignores whether both bands cover the corner it leaves out, so a curl tighter than the half-width has holes',
    file: 'core/path.js',
    from: '      && inBand(b0, p, ax, ay, la, half[i - 1], h) && inBand(a1, c, bx, by, lb, h, half[i + 1]);',
    to: '      ;',
    expect: 'an outline covers its stroke at every corner, from a right angle to a reversal and a tight curl',
  },
  {
    why: 'a zero-width end still gets a cap, a fan of points stacked on the tip',
    file: 'core/path.js',
    from: "    if (cap === 'butt' || h === 0) return arc;",
    to: "    if (cap === 'butt') return arc;",
    expect: 'a width of 0 at the ends tapers the outline to a point there',
  },

  // --- the instrument the documentation names and did not ship ---------------
  {
    why: 'the contact sheet rolls its seeds, so nobody can point at the bad one twice',
    file: 'tools/contact-sheet.js',
    from: '      cells.push({ seed: seeds ? seeds[y] : paramNames.length ? p.seed : x + 1, params });',
    to: '      cells.push({ seed: seeds ? seeds[y] : paramNames.length ? p.seed : Math.floor(Math.random() * 1000), params });',
    expect: 'the contact sheet renders reproducible seeds, not random ones',
  },
  {
    why: 'a parameter sweep changes seeds between cells, confounding the comparison',
    file: 'tools/contact-sheet.js',
    from: '      cells.push({ seed: seeds ? seeds[y] : paramNames.length ? p.seed : x + 1, params });',
    to: '      cells.push({ seed: seeds ? seeds[y] : x + 1, params });',
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
  {
    why: 'periodic2 wraps the near corner but not the far one, so the last cell of a tile reaches into the next tile and the edges show a seam',
    file: 'core/rand.js',
    from: '  return perlin(R, name, i0, (i0 + 1) % px, j0, (j0 + 1) % py, x - xi, y - yi);',
    to: '  return perlin(R, name, i0, i0 + 1, j0, (j0 + 1) % py, x - xi, y - yi);',
    expect: 'periodic2 closes smoothly across its seam, not just in value',
  },
  {
    why: 'periodic2 wraps the far column but not the far row, so the bottom edge of a tile shows a seam',
    file: 'core/rand.js',
    from: '  return perlin(R, name, i0, (i0 + 1) % px, j0, (j0 + 1) % py, x - xi, y - yi);',
    to: '  return perlin(R, name, i0, (i0 + 1) % px, j0, j0 + 1, x - xi, y - yi);',
    expect: 'periodic2 closes smoothly across its seam, not just in value',
  },
  {
    why: 'periodic2 takes a plain remainder, which is negative left of zero, so tiles at negative coordinates are other fields',
    file: 'core/rand.js',
    from: '  const i0 = ((xi % px) + px) % px;',
    to: '  const i0 = xi % px;',
    expect: 'periodic2 repeats exactly over its periods, and is gradient2 inside one tile',
  },
  {
    why: 'periodic2 accepts a fractional period, which no whole number of lattice cells can repeat over',
    file: 'core/rand.js',
    from: '  if (!Number.isInteger(p) || p < 1 || p > 65536) {',
    to: '  if (!(p >= 1) || p > 65536) {',
    expect: 'periodic2 refuses a period that is not a whole number of cells by name',
  },
  {
    why: 'turbulence sums the signed octaves instead of folding them, so it is fbm shifted below zero with no creases',
    file: 'core/rand.js',
    from: '    sum += amp * Math.abs(2 * gradient2(R, x * f, y * f, ns[o]) - 1);',
    to: '    sum += amp * (2 * gradient2(R, x * f, y * f, ns[o]) - 1);',
    expect: 'turbulence folds each octave of gradient2 about its middle',
  },
  {
    why: 'worley2 searches only the 3-by-3 block, so a second-nearest point two cells over is missed and the cracks jump',
    file: 'core/rand.js',
    from: 'for (let r = 0; r <= 2; r++) {',
    to: 'for (let r = 0; r <= 1; r++) {',
    expect: 'worley2 finds the nearest and second-nearest points exactly',
  },
  {
    why: 'worley2 updates the second distance only when the nearest changes, so a point that is second but not first is lost',
    file: 'core/rand.js',
    from: '    if (d < d1) { d2 = d1; d1 = d; id = c; } else if (d < d2) d2 = d;',
    to: '    if (d < d1) { d2 = d1; d1 = d; id = c; }',
    expect: 'worley2 finds the nearest and second-nearest points exactly',
  },
  {
    why: 'the gap to a cell to the right is overstated, so worley2 skips cells that hold the nearest points',
    file: 'core/rand.js',
    from: '  return d > 0 ? d - f : d < 0 ? f - d - 1 : 0;',
    to: '  return d > 0 ? d - f + 1 : d < 0 ? f - d - 1 : 0;',
    expect: 'worley2 finds the nearest and second-nearest points exactly',
  },
  {
    why: 'worley2 ignores the field name, so two named cell fields are one',
    file: 'core/rand.js',
    from: "function worley2(R, x, y, name = 'field') {",
    to: "function worley2(R, x, y, ignored = 'field') { const name = 'field';",
    expect: 'worley2 is a pure function of its arguments, and named fields are independent',
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
    why: 'segments on one side of each other are reported as meeting',
    file: 'core/geom.js',
    from: '  if ((oc > 0 && od > 0) || (oc < 0 && od < 0) || (oa > 0 && ob > 0) || (oa < 0 && ob < 0)) return null;',
    to: '  if (false) return null;',
    expect: 'intersection separates parallel segments and detects an interior crossing',
  },
  {
    why: 'orientation falls back to plain doubles, so near-degenerate answers flip',
    file: 'core/geom.js',
    from: '  if (big <= 2 ** 500) return orient2d(a[0], a[1], b[0], b[1], c[0], c[1]);',
    to: '  if (big <= 2 ** 500) return (a[1] - c[1]) * (b[0] - c[0]) - (a[0] - c[0]) * (b[1] - c[1]);',
    expect: 'near-degenerate segments and points get the exact answer',
  },
  {
    why: 'triangulate drops the holes, so a ring is filled solid',
    file: 'core/mesh.js',
    from: '    starts.push(pts.length);',
    to: '    void starts;',
    expect: 'triangulate covers a concave polygon with a hole exactly, and nothing else',
  },
  {
    why: 'voronoi cells repeat their closing point, unlike every other ring here',
    file: 'core/mesh.js',
    from: '    return cell ? cell.slice(0, -1) : [];',
    to: '    return cell || [];',
    expect: 'voronoi cells tile the bounds, hold their own point, and are nearest to it',
  },
  {
    why: 'the vendored offset loses its by-reference edge again, so every vertex joins the last edge',
    file: 'core/clipper2.js',
    from: '            prev = this.offsetPoint(group, path, i, prev);',
    to: '            this.offsetPoint(group, path, i, prev);',
    expect: 'closed offsets grow, shrink and round a shape by the distance',
  },
  {
    why: 'an open band is passed to Clipper2 as its half-width, so it comes out half as wide',
    file: 'core/clip.js',
    from: '  co.execute(distance * scale * (closed ? 1 : 2), out);',
    to: '  co.execute(distance * scale, out);',
    expect: 'the band round a tight zigzag has no self-crossings where offsetPolyline folds',
  },
  {
    why: 'offset input compares points by object identity again, so a repeated point stays in and bends the joins',
    file: 'core/clipper2.js',
    from: '            if (Point64.notEquals(lastPt, path[i])) {',
    to: '            if (lastPt !== path[i]) {',
    expect: 'boolean results repeat no point, even from input that repeats its points',
  },
  {
    why: 'boolean output compares a new point with the ring front by object identity again, and loses area',
    file: 'core/clipper2.js',
    from: '        if (toFront && Point64.equals(pt, opFront.pt))',
    to: '        if (toFront && (pt == opFront.pt))',
    expect: 'booleans compare output points by their coordinates, so an equal point is not added twice',
  },
  {
    why: 'a one-point open line offsets to a square of no size again, so it disappears',
    file: 'core/clipper2.js',
    from: 'new Rect64(path[0].x - d, path[0].y - d, path[0].x + d, path[0].y + d)',
    to: 'new Rect64(path[0].x - d, path[0].y - d, path[0].x - d, path[0].y - d)',
    expect: 'a one-point line offsets to a square twice the distance across, or a round dot',
  },
  {
    why: 'closed offsets skip the merge by fill, so rings wound against the lowest one are lost',
    file: 'core/clip.js',
    from: '  if (closed) paths = Clipper.BooleanOp(ClipType.Union, paths, new Paths64(), rule);',
    to: '  if (closed && rule < 0) paths = Clipper.BooleanOp(ClipType.Union, paths, new Paths64(), rule);',
    expect: 'closed offsets merge their rings by fill first, so winding does not matter',
  },
  {
    why: 'collinear overlap discards its extent and returns only one point',
    file: 'core/geom.js',
    from: "    return { type: 'overlap', points: [[...start], [...end]] };",
    to: '    return hit(start);',
    expect: 'collinear overlap keeps both ends in the first segment direction',
  },
  {
    why: 'an endpoint lying on the other segment is dropped, losing T junctions and touching ends',
    file: 'core/geom.js',
    from: '  if (oa === 0) return hit(a);\n  if (ob === 0) return hit(b);\n  if (oc === 0) return hit(c);\n  if (od === 0) return hit(d);',
    to: '  if (oa === 0 || ob === 0 || oc === 0 || od === 0) return null;',
    expect: 'touching segment ends and T junctions are single point intersections',
  },
  {
    why: 'a zero-length segment hits every line even away from that line',
    file: 'core/geom.js',
    from: '    return orient(c, d, a) === 0 && within(a, c, d) ? hit(a) : null;',
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
    from: '      if (orient(lo, up, p) < 0) hit = !hit;',
    to: '      if (orient(lo, up, p) < Infinity) hit = !hit;',
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
    from: 'kept.push(slots.map((k) => g[k])); transforms.save(); };',
    to: 'kept.push(slots.map((k) => g[k])); };',
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
    file: 'core/export.js',
    from: '  var scale = opts && opts.scale !== undefined ? opts.scale : film.filmScale(p);',
    to: '  var scale = opts && opts.scale !== undefined ? opts.scale : 1;',
    expect: 'the page films at 1920 pixels on the long edge unless told a scale, at the bitrate it is given',
  },
  {
    why: 'the page drops the bitrate a script gives its film',
    file: 'core/export.js',
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
    file: 'core/export.js',
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
    why: 'the export stops reading its frames for flashes, so a film that flashes reports none',
    file: 'core/film.js',
    from: '        flashes.read(canvas);\n',
    to: '',
    expect: 'the film report counts the flashes in the frames it encodes',
  },
  {
    why: 'the worker that counts the flashes answers in the shrunk frame\'s units, not the design box\'s',
    file: 'core/flash.js',
    from: 'postMessage(counter.result(data.box));',
    to: 'postMessage(counter.result());',
    expect: 'the flash reader counts the same in a worker as on the page',
  },
  {
    why: 'a page that refuses the flash worker fails the export instead of counting on the page',
    file: 'core/flash.js',
    from: 'try { worker = new Worker(url); } catch (e) { URL.revokeObjectURL(url); }',
    to: 'worker = new Worker(url);',
    expect: 'the flash reader counts on the page when the page refuses its worker',
  },
  {
    why: 'a flash worker that fails part-way fails the export, though its frames can be drawn again',
    file: 'core/flash.js',
    from: '          if (!redraw) throw e;',
    to: '          throw e;',
    expect: 'the flash reader counts every frame again on the page when its worker fails part-way',
  },
  {
    why: 'a pass the export leaves early keeps its flash worker running',
    file: 'core/film.js',
    from: '      flashes.close();\n',
    to: '',
    expect: 'an export whose flash worker fails still counts its flashes, and stops the worker of a pass it leaves',
  },
  {
    why: 'any flashing area counts, however small a part of a 10 degree field it covers',
    file: 'core/flash.js',
    from: 'changing[at + s] = area > enough ? 1 : 0;',
    to: 'changing[at + s] = area > 0 ? 1 : 0;',
    expect: 'a small flashing area under the area rule is not counted, one over it is',
  },
  {
    why: 'a swing between two bright states counts as a general flash, though its darker state is not below 0.8',
    file: 'core/flash.js',
    from: ' || Math.min(ext[p], pivot[p]) >= WCAG.darker) return;',
    to: ') return;',
    expect: 'a swing under the general threshold, or between two bright states, is no flash',
  },
  {
    why: 'a crimson under 0.8 of R / (R + G + B) counts as saturated red, so its flashes are counted as red flashes',
    file: 'core/flash.js',
    from: 'red: 0.8, chroma',
    to: 'red: 0.6, chroma',
    expect: 'saturated red too dark to flash in brightness counts as a red flash',
  },
  {
    why: 'a second counts the more of its rises and falls, so a picture brightening in steps flashes',
    file: 'core/flash.js',
    from: 'const flashes = Math.min(recent[at].length, recent[at + 1].length);',
    to: 'const flashes = Math.max(recent[at].length, recent[at + 1].length);',
    expect: 'a frame brightening in steps, never darkening, is no flash',
  },
  {
    why: 'without slack a transition is dated from frames before it began, and grain extends it',
    file: 'core/flash.js',
    from: 'const slack = step / 4;',
    to: 'const slack = 0;',
    expect: 'a flash is dated from the frame its first change happens in',
  },
  {
    why: 'the page warns of exactly three flashes a second, which WCAG allows',
    file: 'core/flash.js',
    from: 'if (!w || w.flashes <= WCAG.flashes) return \'\';',
    to: 'if (!w || w.flashes < WCAG.flashes) return \'\';',
    expect: 'the film note warns of flashes only past three a second',
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
    from: 'const picture = (s) => sampleBt709(bytesOf(s.data), (avcC[4] & 3) + 1);',
    to: 'const picture = (s) => bytesOf(s.data);',
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
    from: '              if ((data[p + x.nalLength] & 31) === 7) x.sps.push(',
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
    why: 'the CPU route never draws a GPU canvas into the film canvas, so a browser with a GPU draws the film in memory, three times slower',
    file: 'core/film.js',
    from: '      g.drawImage(one, 0, 0);',
    to: '      one.width;',
    expect: 'every frame reaches the encoder as BT.709 limited-range NV12, whatever the encoder reports',
  },
  {
    why: 'a CPU-route film whose canvas loses its GPU is written with the blank frames it read back',
    file: 'core/film.js',
    from: "canvas.addEventListener('contextlost',",
    to: "canvas.addEventListener('contextrestored',",
    expect: 'a CPU-route film whose canvas loses its GPU is drawn again on a canvas kept in memory',
  },
  {
    why: 'the test pattern says the GPU drew the film wherever the browser drew it',
    file: 'core/film.js',
    from: "  return same(film, gpu) ? 'gpu' : same(film, memory) ? 'memory' : null;",
    to: "  return 'gpu';",
    expect: 'the report names where the browser drew the CPU route\'s film, by a test pattern that leaves no trace on it',
  },
  {
    why: 'the test pattern leaves its fill style on the film canvas, so the first frame is drawn in its colour',
    file: 'core/film.js',
    from: '    c.restore();\n',
    to: '',
    expect: 'the report names where the browser drew the CPU route\'s film, by a test pattern that leaves no trace on it',
  },
  {
    why: 'a CPU-route film drawn in memory passes the browser check with WebGL2 hidden, so a browser that stopped moving its canvas to the GPU goes unseen',
    file: 'tools/check-browser.js',
    from: "if (film.rasterizer === 'gpu' || options.allowFallback",
    to: "if (true || options.allowFallback",
    expect: 'with WebGL2 hidden the CPU route must have drawn its film on the GPU, unless it was drawn again in memory or a fallback is accepted',
  },
  {
    why: 'a film drawn again in memory after its canvas lost the GPU fails the browser check for being drawn in memory',
    file: 'core/export.js',
    from: "return r.contextLost || /(^|; )video: /",
    to: "return /(^|; )video: /",
    expect: 'with WebGL2 hidden the CPU route must have drawn its film on the GPU, unless it was drawn again in memory or a fallback is accepted',
  },
  {
    why: 'a CPU-route film converted after its encoder route was dropped counts as drawn again in memory, so it passes the browser check with WebGL2 hidden wherever it was drawn',
    file: 'tools/check-browser.js',
    from: "options.allowFallback || filmDrawnAgain(film) === 'memory') return null;",
    to: 'options.allowFallback || filmDrawnAgain(film)) return null;',
    expect: 'with WebGL2 hidden the CPU route must have drawn its film on the GPU, unless it was drawn again in memory or a fallback is accepted',
  },
  {
    why: 'the summary says a film converted after its encoder route was dropped was drawn again in memory',
    file: 'tools/check-browser.js',
    from: "if (!before && filmDrawnAgain(film) !== 'memory') return '';",
    to: "if (!before && !filmDrawnAgain(film)) return '';",
    expect: 'the summary names where a film drawn again in memory was first drawn, and says nothing of a film drawn once',
  },
  {
    why: 'a captured sheet keeps the images of sections an earlier run had, so a stale piece\'s image stays to be opened',
    file: 'tools/check-browser.js',
    from: '  if (sections.length > 1) await removeGoneSections(stem, sections.map((section) => section.name));\n',
    to: '',
    expect: 'a captured sheet of several sections removes the images of sections it no longer has',
  },
  {
    why: 'seeds --json alone still takes and writes the sheet\'s screenshots',
    file: 'tools/check-browser.js',
    from: '    if (!images || sheet.refusal) return { shots: [], cells, failures: sheet.failures, sheet };\n',
    to: '',
    expect: 'contact sheet: --json alone reads window.__sheet and never takes a screenshot',
  },
  {
    why: 'seeds --png writes the images of a sheet the page refused',
    file: 'tools/check-browser.js',
    from: '    if (!images || sheet.refusal) return',
    to: '    if (!images) return',
    expect: 'contact sheet: --png writes no image of a sheet that carries a refusal',
  },
  {
    why: 'seeds main builds a --json strip in Node instead of leaving its shots to the page',
    file: 'tools/contact-sheet.js',
    from: 'strip, drawsInPage(args));',
    to: 'strip, false);',
    expect: 'contact sheet: seeds main hands a --json strip to the page to tag, refuses the sheet the page refused, and a plain run captures nothing',
  },
  {
    why: 'seeds main ignores the refusal of the sheet the page drew',
    file: 'tools/contact-sheet.js',
    from: '    refuseSheet(sheet);\n',
    to: '',
    expect: 'contact sheet: seeds main hands a --json strip to the page to tag, refuses the sheet the page refused, and a plain run captures nothing',
  },
  {
    why: 'a plain seeds run draws the sheet in Edge',
    file: 'tools/contact-sheet.js',
    from: '  if (!drawsInPage(args)) return undefined;\n',
    to: '',
    expect: 'contact sheet: seeds main hands a --json strip to the page to tag, refuses the sheet the page refused, and a plain run captures nothing',
  },
  {
    why: 'a film drawn in memory, then drawn again there after a GPU loss, passes the browser check with WebGL2 hidden',
    file: 'tools/check-browser.js',
    from: "if (film.rasterizerBeforeRedraw === 'memory' && !options.allowFallback)",
    to: 'if (false)',
    expect: 'with WebGL2 hidden a film drawn again in memory fails when the pass it replaced was drawn in memory too',
  },
  {
    why: 'a film drawn again in memory drops where the pass it replaced was drawn, so the browser check cannot refuse it',
    file: 'core/film.js',
    from: '    replaced = watchedOn;\n',
    to: '',
    expect: 'a CPU-route film drawn again in memory reports where the pass it replaced was drawn',
  },
  {
    why: 'a film whose canvas lost its GPU on its last frame is written with that blank frame',
    file: 'core/film.js',
    from: '      if (gone()) return { lost: true };\n      flashMs',
    to: '      flashMs',
    expect: 'a CPU-route film whose canvas loses its GPU is drawn again on a canvas kept in memory',
  },
  {
    why: 'a lost GPU that says so only after the last frame leaves that frame blank in the film',
    file: 'core/film.js',
    from: '      if (watched) await pause(LOSS_MS);\n',
    to: '',
    expect: 'a CPU-route film whose canvas loses its GPU is drawn again on a canvas kept in memory',
  },
  {
    why: 'a finished pass keeps listening, so a later GPU crash can still flip its flag',
    file: 'core/film.js',
    from: "      if (watched && canvas.removeEventListener) canvas.removeEventListener('contextlost', onLost);\n",
    to: '',
    expect: 'a CPU-route film whose canvas loses its GPU is drawn again on a canvas kept in memory',
  },
  {
    why: 'an encoder killed by a GPU crash fails the export where a fresh encoder would finish the film',
    file: 'core/film.js',
    from: '  if (film.lost || film.failed) {',
    to: '  if (film.lost) {',
    expect: 'a film whose encoder fails is drawn once more in memory on a fresh encoder, and fails if that one fails too',
  },
  {
    why: 'a pass that reported no frames is announced as a restart when the film is drawn again in memory',
    file: 'core/film.js',
    from: '    if (reported) restart = `starting over in memory: ',
    to: '    restart = `starting over in memory: ',
    expect: 'a film whose encoder fails is drawn once more in memory on a fresh encoder, and fails if that one fails too',
  },
  {
    why: 'a film drawn again in memory gives the other cause: a lost canvas reads as a failed encoder',
    file: 'core/film.js',
    from: "${film.lost ? 'the canvas lost its GPU' : 'the encoder failed'}",
    to: "${film.lost ? 'the encoder failed' : 'the canvas lost its GPU'}",
    expect: 'a CPU-route film whose canvas loses its GPU is drawn again on a canvas kept in memory',
  },
  {
    why: 'a film drawn again in memory reuses the old solve, whose kept canvases the GPU crash blanked',
    file: 'core/film.js',
    from: '    film = await pass(\'cpu\', null, true, solve(piece, solved.seed, solved.manifest.params));',
    to: '    film = await pass(\'cpu\', null, true);',
    expect: 'a film drawn again after its canvas lost the GPU draws from a fresh solve, since the crash blanked the canvases kept with the old one',
  },
  {
    why: 'an audio encoder killed by a GPU crash fails the export where a fresh encoder would finish the soundtrack',
    file: 'core/film.js',
    from: "      restarts.push('sound: ' + sound.failed);\n      sound = await encodeSound(env, buffer, soundCodec);\n",
    to: '      throw sound.failed;\n',
    expect: 'a soundtrack whose encoder fails is encoded once more on a fresh encoder, and fails if that one fails too',
  },
  {
    why: 'a soundtrack refused for a fault of its own, such as a missing OpusHead, is encoded again for nothing',
    file: 'core/film.js',
    from: '    if (!failure) { if (encoder.state !== \'closed\') encoder.close(); throw e; }\n  }',
    to: '    return { failed: failure || e };\n  }',
    expect: 'a soundtrack refused for a fault a fresh encoder repeats is not encoded again',
  },
  {
    why: 'a video encoder that fails on the encoder route goes unreported in the film converted instead',
    file: 'core/film.js',
    from: "    if (why) restarts.push('encoder route: ' + why);\n",
    to: '',
    expect: 'a video encoder that fails on the encoder route is named in the report of the film converted instead',
  },
  {
    why: 'an encoder route dropped after it drew frames of the film goes unreported, so the saved note never says the film was drawn twice',
    file: 'core/film.js',
    from: 'film.failed || film.dropped',
    to: 'film.failed',
    expect: 'an encoder route dropped after it drew frames is named in the report, and one never proven is not',
  },
  {
    why: 'an encoder route whose encoder failed on its first probe, before any frame of the film, is named, so the saved note says a film drawn once was drawn twice',
    file: 'core/film.js',
    from: 'const why = film && reported && (',
    to: 'const why = film && (',
    expect: 'an encoder route dropped after it drew frames is named in the report, and one never proven is not',
  },
  {
    why: 'a hardware encoder that failed on the encoder route\'s first probe goes unreported in the film converted instead',
    file: 'core/film.js',
    from: "    else if (film && film.failed) restarts.push('encoder probe: ' + film.failed);\n",
    to: '',
    expect: 'an encoder route dropped after it drew frames is named in the report, and one never proven is not',
  },
  {
    why: 'an encoder route that throws after it drew frames of the film goes unreported, so the saved note never says the film was drawn twice',
    file: 'core/film.js',
    from: "catch (e) { film = { dropped: String(e) }; }",
    to: 'catch (e) { film = null; }',
    expect: 'an encoder route dropped after it drew frames is named in the report, and one never proven is not',
  },
  {
    why: 'an encoder that reported an error on the encoder route but resolved its flush is counted short and converted with no record of its failure',
    file: 'core/film.js',
    from: '      if (copy && failure) throw failure;\n',
    to: '',
    expect: 'an encoder route whose encoder reported an error on the last frame, and still flushed, is named in the report',
  },
  {
    why: 'a film converted after its encoder route was dropped says nothing of being drawn twice',
    file: 'core/export.js',
    from: " : /(^|; )encoder route: /.test(failed) ? 'converted' : null;",
    to: ' : null;',
    expect: 'a film is drawn again in memory, converted after its encoder route was dropped, or once, as its report says, and a converted one says it was drawn twice',
  },
  {
    why: 'a draw that throws after the encoder reported an error is replaced by that error, and the film drawn again',
    file: 'core/film.js',
    from: '      if (!failure || e !== failure) throw e;',
    to: '      if (!failure) throw e;',
    expect: 'a draw that throws in a pass whose encoder has reported an error fails the export with its own error',
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
    from: "    try { film = await pass('encoder'); } catch (e) { film = { dropped: String(e) }; }",
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
    from: "      if (copy && !await probe(shift + stamp(heads.length))) return { dropped: 'the test pattern after the last frame did not come back as drawn' };\n",
    to: '',
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
    from: '        if (copy && !spaces.every(limited709)) return { dropped: UNLIMITED };\n',
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
    from: '  const start = ftyp.length + moov().length + 8;',
    to: '  const start = ftyp.length + moov().length - udta.length + 8;',
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
    from: '      if (copy && chunks.length !== heads.length) return { dropped: `the encoder returned ${chunks.length} of ${heads.length} frames` };\n',
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
    from: '(x) => ({ ...x, timestamp: x.timestamp - shift })), drawMs, convertMs, waitMs, flashMs,',
    to: '(x) => ({ ...x, timestamp: x.timestamp - shift })), flashMs,',
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
    from: '  let gain = Math.min(want, room), limited = 0, cuts = null;\n  if (want > room) {',
    to: '  let gain = Math.min(want, room), limited = 0, cuts = null;\n  if (false) {',
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
    from: 'attack: 0.005, release: 0.05,\n',
    to: 'attack: 0.005, release: 0.1,\n',
    expect: 'the limiter meets every peak on both channels from the first sample, ahead of it, and lets go over 50 ms',
  },
  {
    why: 'the limiter looks further ahead than it states, turning down before 5 ms and 12 samples ahead of a peak',
    file: 'core/film.js',
    from: 'attack: 0.005, release: 0.05,\n',
    to: 'attack: 0.01, release: 0.05,\n',
    expect: 'the limiter meets every peak on both channels from the first sample, ahead of it, and lets go over 50 ms',
  },
  {
    why: 'an AAC soundtrack is limited under a ceiling 1 dB higher, and AAC lifts limited peaks past the ceiling plus the rise once decoded',
    file: 'core/film.js',
    from: 'ceiling: { mp4a: -2, Opus: -2 }',
    to: 'ceiling: { mp4a: -1, Opus: -2 }',
    expect: 'every film soundtrack reaches -14 LUFS, its peaks limited under -2 dBTP, AAC and Opus alike, by 12 dB at most',
  },
  {
    why: 'an Opus soundtrack is limited under a ceiling 0.8 dB higher, and Opus lifts limited peaks past the ceiling plus the rise once decoded',
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
    why: 'a sparse soundtrack is limited as deep as drums, its accents flattened into its bed',
    file: 'core/film.js',
    from: 'sparse: { depth: 6,',
    to: 'sparse: { depth: 12,',
    expect: 'a sparse soundtrack keeps its accents: cracks over a quiet bed are cut 6 dB at most and stop short of -14 LUFS',
  },
  {
    why: 'the depth jumps from the sparse one to the full one, so a seed either side of the step levels 6 dB apart',
    file: 'core/film.js',
    from: 'Math.min(1, Math.max(0, (gate.share - from) / (to - from)))',
    to: '(gate.share >= to ? 1 : 0)',
    expect: 'a sparse soundtrack keeps its accents: cracks over a quiet bed are cut 6 dB at most and stop short of -14 LUFS',
  },
  {
    why: 'the share leaves a silent start and end out, so a seam whose sound sits mid-film is limited as deep as drums again',
    file: 'core/film.js',
    from: 'gate.share = passed.length / blocks.length;',
    to: 'gate.share = passed.length / (blocks.findLastIndex((z) => lufs(z) > -70) - blocks.findIndex((z) => lufs(z) > -70) + 1);',
    expect: 'a sparse soundtrack keeps its accents: cracks over a quiet bed are cut 6 dB at most and stop short of -14 LUFS',
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
    file: 'core/export.js',
    from: '  const slow = pace && pace.worstLagMs > budget',
    to: '  const slow = false',
    expect: 'a film too slow to record in real time says so, and names the export that can',
  },
  {
    why: "a WebM refused after the recorder's encoder stalled blames a piece that drew in time",
    file: 'core/export.js',
    from: '  const drawing = pace && (pace.worstDrawMs > budget || !(pace.worstWriteMs > pace.worstDrawMs));',
    to: '  const drawing = pace;',
    expect: 'a WebM refused after the recorder stalls on its first writes blames the recorder, not a piece that draws in time',
  },
  {
    why: 'a frame that drew past its budget is blamed on the recorder when a write took longer',
    file: 'core/export.js',
    from: '  const drawing = pace && (pace.worstDrawMs > budget || !(pace.worstWriteMs > pace.worstDrawMs));',
    to: '  const drawing = pace && !(pace.worstWriteMs > pace.worstDrawMs);',
    expect: 'a film too slow to record in real time says so, and names the export that can',
  },
  {
    why: "the WebM export times a frame's draw from its slot, so an encoder stall before it counts as drawing",
    file: 'core/export.js',
    from: '      worstDrawMs = Math.max(worstDrawMs, b - a);',
    to: '      worstDrawMs = Math.max(worstDrawMs, b - due);',
    expect: 'a WebM refused after the recorder stalls on its first writes blames the recorder, not a piece that draws in time',
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
    file: 'core/export.js',
    from: '  g.setManifest(recipe(p, s, t));',
    to: '',
    expect: 'an SVG saved from the page names the recipe manifest() names, in the bytes renderVector writes',
  },
  {
    why: 'the PNG manifest reader looks for its nulls past the chunk, and on a cut file never stops',
    file: 'core/export.js',
    from: "      if (at >= end) throw new Error('the artifex-manifest chunk ends before its text');",
    to: '',
    expect: 'a PNG cut short inside its manifest chunk, or a chunk without its text, is refused by name',
  },
  {
    why: 'the manifest chunk\'s CRC is left uncomplemented, so an image tool reports the PNG as corrupt',
    file: 'core/export.js',
    from: '  return ~crc >>> 0;',
    to: '  return crc >>> 0;',
    expect: 'a PNG carries its recipe in one iTXt chunk before IEND, and every other byte as encoded',
  },
  {
    why: 'a PNG saved from the page is saved as encoded, so a print master cannot name its recipe',
    file: 'core/export.js',
    from: "    return new Blob([pngWithManifest(new Uint8Array(buf), manifest)], { type: 'image/png' });",
    to: "    return new Blob([new Uint8Array(buf)], { type: 'image/png' });",
    expect: 'a PNG saved from the page names its recipe and the scale it was drawn at',
  },
  {
    why: 'a PNG master\'s recipe leaves out its scale, and a piece may draw finer detail at a higher one',
    file: 'core/export.js',
    from: '  var manifest = Object.assign(recipe(p, s, t), { scale: k });',
    to: '  var manifest = recipe(p, s, t);',
    expect: 'a PNG saved from the page names its recipe and the scale it was drawn at',
  },
  {
    why: 'the WebM export hands the recorder its alpha plane, and Edge scales that film on another path',
    file: 'core/export.js',
    from: "    var f = new VideoFrame(copy, { timestamp: Math.round((i * 1000000) / hz), alpha: 'discard' });",
    to: '    var f = new VideoFrame(copy, { timestamp: Math.round((i * 1000000) / hz) });',
    expect: 'the WebM export records frames without alpha and saves the film with its length',
  },
  {
    why: 'the WebM recorder takes frames from the canvas the piece draws on, so a piece that reads it back switches the film to full range mid-way',
    file: 'core/export.js',
    from: "    var f = new VideoFrame(copy, { timestamp: Math.round((i * 1000000) / hz), alpha: 'discard' });",
    to: "    var f = new VideoFrame(off, { timestamp: Math.round((i * 1000000) / hz), alpha: 'discard' });",
    expect: 'the WebM export records a copy of each frame, on a canvas no piece reads back',
  },
  {
    why: 'the WebM export saves the film as recorded, so a player shows it as 0.001 s long',
    file: 'core/export.js',
    from: "  var blob = new Blob([webmWithManifest(webmWithDuration(bytes, heads.length / hz), manifest)], { type: 'video/webm' });",
    to: "  var blob = new Blob([webmWithManifest(bytes, manifest)], { type: 'video/webm' });",
    expect: 'the WebM export records frames without alpha and saves the film with its length',
  },
  {
    why: 'the WebM export records its first film on a cold encoder, which drops frames',
    file: 'core/export.js',
    from: '  await warmRecorder(copy, macro);\n',
    to: '',
    expect: 'the WebM export starts a cold encoder before the film, so its first recording keeps every frame',
  },
  {
    why: 'an Opus film is saved without the warning, and its author learns only in a player that plays it silent',
    file: 'core/export.js',
    from: "  return (r.sound && r.sound.codec === 'Opus' ? ' This browser encodes no AAC, so the soundtrack is Opus: play the film where Opus in MP4 is supported, or it plays silent.' : '')\n",
    to: "  return ''\n",
    expect: 'the MP4 note names the soundtrack codec and the colour route, and warns about Opus',
  },
  {
    why: 'the WebM export saves the film without its recipe, so a fallback film cannot say what made it',
    file: 'core/export.js',
    from: "  var blob = new Blob([webmWithManifest(webmWithDuration(bytes, heads.length / hz), manifest)], { type: 'video/webm' });",
    to: "  var blob = new Blob([webmWithDuration(bytes, heads.length / hz)], { type: 'video/webm' });",
    expect: 'the WebM export names the recipe an MP4 of the same film names',
  },
  {
    why: 'every Tags part claims one byte more than it holds, so a reader runs into the next part',
    file: 'core/export.js',
    from: '    for (let i = 7, v = body.length; i > 0; i--, v = Math.floor(v / 256)) size[i] = v % 256;',
    to: '    for (let i = 7, v = body.length + 1; i > 0; i--, v = Math.floor(v / 256)) size[i] = v % 256;',
    expect: 'a WebM carries its recipe in one Tags element before the first Cluster, and every other byte as saved',
  },
  {
    why: 'a Segment of known size keeps its old size after the Tags go in, so a reader stops short of the last Cluster',
    file: 'core/export.js',
    from: '  if (segment && !segment.unknown) ebmlResize(src, segment, segment.size + total);',
    to: '',
    expect: 'a WebM carries its recipe in one Tags element before the first Cluster, and every other byte as saved',
  },
  {
    why: 'stored positions keep their recorded values, so the Cues Edge writes name the Tags where the first Cluster was',
    file: 'core/export.js',
    from: '        let v = move(uint(c.body, c.size)), n = c.size;',
    to: '        let v = uint(c.body, c.size), n = c.size;',
    expect: 'a WebM insertion moves every stored position with the element it names',
  },
  {
    why: 'a moved position keeps its field width, so its high byte is lost and it points into the Tags',
    file: 'core/export.js',
    from: '        while (v >= 256 ** n) n++;',
    to: '',
    expect: 'a WebM insertion moves every stored position with the element it names',
  },
  {
    why: 'a SeekHead or Cues that grows moves nothing after it, so every position past it falls short',
    file: 'core/export.js',
    from: '  const move = (P) => P + (P >= at - base ? added.length : 0) + index.reduce((sum, e, i) => sum + (e.at - base < P ? grown[i] : 0), 0);',
    to: '  const move = (P) => P + (P >= at - base ? added.length : 0);',
    expect: 'a WebM insertion moves every stored position with the element it names',
  },
  {
    why: 'a CueCodecState, CueReference or misplaced CRC-32 inside an index is copied as it was, and goes stale',
    file: 'core/export.js',
    from: '      if (c.id in REFUSED) refuse(c.id);',
    to: '',
    expect: 'a WebM that stores a position the insertion cannot move is refused by name',
  },
  {
    why: 'a Cluster that stores its own position is saved with it, pointing short of where the Cluster now sits',
    file: 'core/export.js',
    from: '    if (e.id === 0xA7) refuse(e.id);',
    to: '',
    expect: 'a WebM that stores a position the insertion cannot move is refused by name',
  },
  {
    why: 'the page leaves Info\'s CRC-32 as recorded after writing the Duration, so a checking reader finds Info corrupt',
    file: 'core/export.js',
    from: '        if (c.id === CRC && c.size === 4) new DataView(out.buffer, out.byteOffset).setUint32(c.body, crc32(out.subarray(c.body + 4, e.body + e.size)), true);',
    to: '',
    expect: 'a WebM keeps every CRC-32 matching its element when the page writes its length',
  },
  {
    why: 'Info\'s CRC-32 is stored big-endian, where EBML stores it little-endian',
    file: 'core/export.js',
    from: '        if (c.id === CRC && c.size === 4) new DataView(out.buffer, out.byteOffset).setUint32(c.body, crc32(out.subarray(c.body + 4, e.body + e.size)), true);',
    to: '        if (c.id === CRC && c.size === 4) new DataView(out.buffer, out.byteOffset).setUint32(c.body, crc32(out.subarray(c.body + 4, e.body + e.size)), false);',
    expect: 'a WebM keeps every CRC-32 matching its element when the page writes its length',
  },
  {
    why: 'writing the Duration keeps a CRC-32 over the whole Segment as recorded, and it goes stale',
    file: 'core/export.js',
    from: "        if (ebmlHead(out, e.body).id === CRC) throw new Error('the recorded WebM carries a CRC-32 over its Segment, which writing its length would leave stale');",
    to: '',
    expect: 'a WebM keeps every CRC-32 matching its element when the page writes its length',
  },
  {
    why: 'an insertion keeps a CRC-32 over the whole Segment as recorded, and it goes stale',
    file: 'core/export.js',
    from: '      if (ebmlHead(bytes, e.body).id === 0xBF) refuse(0xBF);',
    to: '',
    expect: 'a WebM keeps every CRC-32 matching its element when the page writes its length',
  },
  {
    why: 'a rebuilt SeekHead or Cues keeps the CRC-32 it was recorded with, so a checking reader finds it corrupt',
    file: 'core/export.js',
    from: '      body = [0xBF, 0x84, sum & 255, (sum >>> 8) & 255, (sum >>> 16) & 255, sum >>> 24, ...body];',
    to: '      body = [...bytes.subarray(e.body, e.body + 6), ...body];',
    expect: 'a WebM SeekHead or Cues that opens with a CRC-32 keeps it matching through the page\'s edits',
  },
  {
    why: 'a rebuilt SeekHead or Cues loses its CRC-32',
    file: 'core/export.js',
    from: '      if (q === e.body && c.id === 0xBF && c.size === 4) { summed = true; q = c.body + c.size; continue; }',
    to: '      if (q === e.body && c.id === 0xBF && c.size === 4) { q = c.body + c.size; continue; }',
    expect: 'a WebM SeekHead or Cues that opens with a CRC-32 keeps it matching through the page\'s edits',
  },
  {
    why: 'a finalized recording\'s SeekHead leaves the Tags out, so a reader that finds elements through it misses the recipe',
    file: 'core/export.js',
    from: '    return webmInsert(bytes, p, tags, null, true);',
    to: '    return webmInsert(bytes, p, tags, null);',
    expect: 'a WebM SeekHead lists the Tags the page adds, and a reader that follows it finds the recipe',
  },
  {
    why: 'the Seek entry for the Tags points past them, at the first Cluster',
    file: 'core/export.js',
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
    file: 'core/export.js',
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
    file: 'core/export.js',
    from: '    voiced = asked.sound;',
    to: '    voiced = true;',
    expect: 'where neither AAC nor Opus encodes, a piece with sound is offered a silent WebM',
  },
  {
    why: 'a piece without sound loses its MP4 film because the browser encodes no soundtrack codec',
    file: 'core/export.js',
    from: '  if (p.time && p.sound) {',
    to: '  if (p.time) {',
    expect: 'a piece without sound keeps the MP4 film where neither AAC nor Opus encodes',
  },
  {
    why: 'the page tells a script the soundtrack is to blame where H.264 is',
    file: 'core/export.js',
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
    from: '  return list[lastAtOrBefore(starts, frame)];',
    to: '  return list[lastAtOrBefore(starts, frame - 1)];',
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
  {
    why: 'the readout read is one flat level again, with no swell to the middle rows',
    file: 'examples/readout.js',
    from: '      const phrase = 0.4 + 0.6 * Math.sin(Math.PI * c.k / (s.cells.length - 1));',
    to: '      const phrase = 1;',
    expect: 'readout: the reading is heard as one phrase, with its accents standing out',
  },
  {
    why: 'the readout accent-coloured digits sound no louder than the plain ones',
    file: 'examples/readout.js',
    from: '(c.digit >= 7 ? 1.5 : 1);',
    to: '(c.digit >= 7 ? 1 : 1);',
    expect: 'readout: the reading is heard as one phrase, with its accents standing out',
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
    why: 'settle starts each sound a frame after the picture shows its cause',
    file: 'examples/settle.js',
    from: '      const v = voice(ctx, R, `${ev.kind} ${n}`, ev.frame / timeline.hz, ',
    to: '      const v = voice(ctx, R, `${ev.kind} ${n}`, (ev.frame + 1) / timeline.hz, ',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle snaps every edge at one level, however hard it was pulled',
    file: 'examples/settle.js',
    from: 'velocity: hard(speed, SNAP, FAST), x:',
    to: 'velocity: 0.6, x:',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle hears a snap at full level from a fifth of its range, so most of the opening rattle sounds at one level',
    file: 'examples/settle.js',
    from: 'const FAST = 84;             // design units of stretch per frame at which a',
    to: 'const FAST = 8;              // design units of stretch per frame at which a',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle hears its knocks over the snaps\' range, so most knocks after the first pluck sound at one floor level',
    file: 'examples/settle.js',
    from: 'velocity: hard(knock.speed, KNOCK_SOFT, KNOCK_HARD), x:',
    to: 'velocity: hard(knock.speed, SNAP, FAST), x:',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle plays every knock at one level, whatever level the build heard it at',
    file: 'examples/settle.js',
    from: '      spec.velocity = ev.velocity;',
    to: '      spec.velocity = ev.kind === \'knock\' ? 0.6 : ev.velocity;',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle plucks a node a frame before the sound of the pluck',
    file: 'examples/settle.js',
    from: '      const kicks = new Map(s.plucks.map((k) => [(k.frame - 1) * SUB, k]));',
    to: '      const kicks = new Map(s.plucks.map((k) => [(k.frame - 2) * SUB, k]));',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle\'s medium thickens past HOLD to a stop, so frames between the plucks hold one picture',
    file: 'examples/settle.js',
    from: '        const damp = Math.max(HOLD, DAMP0 - ((DAMP0 - HOLD) * Math.max(0, sec - THIN)) / (THICK - THIN));',
    to: '        const damp = DAMP0 - ((DAMP0 - HOLD) * Math.max(0, sec - THIN)) / (THICK - THIN);',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle hears the slowest snaps on a busy frame, not the fastest',
    file: 'examples/settle.js',
    from: '        snaps.sort((x, y) => y.speed - x.speed || x.e - y.e);',
    to: '        snaps.sort((x, y) => x.speed - y.speed || x.e - y.e);',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle hears one snap a frame where two are due',
    file: 'examples/settle.js',
    from: 'const BUSY = 2;              // the most snaps heard on one frame, the fastest',
    to: 'const BUSY = 1;              // the most snaps heard on one frame, the fastest',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle\'s last pluck comes a second before the end, so the last frame holds still',
    file: 'examples/settle.js',
    from: 'const PLUCK_TO = 5.85;',
    to: 'const PLUCK_TO = 5;',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle solves one frame of time more before its last snapshot, so the last frame spans two',
    file: 'examples/settle.js',
    from: '        if (step + 1 === frame * SUB) {',
    to: '        if (step + 1 === frame * SUB + (frame === LAST ? SUB : 0)) {',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle\'s charge range opens to 2600, where the graph rests against its containment',
    file: 'examples/settle.js',
    from: '    charge: { min: 200, max: 700, value: 500,',
    to: '    charge: { min: 200, max: 2600, value: 500,',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle\'s containment shrinks to where the graph rests against it, and the test measures a copy of the old one',
    file: 'examples/settle.js',
    from: 'const EX = 268;',
    to: 'const EX = 190;',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle plucks every node at one level, however far it flies',
    file: 'examples/settle.js',
    from: 'velocity: Math.min(1, speed / FLY), x, y });',
    to: 'velocity: 1, x, y });',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle plucks before its rattle has thinned, so the first pluck lands in the collapse',
    file: 'examples/settle.js',
    from: 'const PLUCK_FROM = 3.0;      // seconds',
    to: 'const PLUCK_FROM = 2.4;      // seconds',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle hears an edge that shortens fast as one pulled taut',
    file: 'examples/settle.js',
    from: '          if (len(f, e) > REST && pull >= SNAP && before < SNAP && f - heard[e] > QUIET) snaps.push({ e, speed: pull });',
    to: '          if (len(f, e) > REST && Math.abs(pull) >= SNAP && Math.abs(before) < SNAP && f - heard[e] > QUIET) snaps.push({ e, speed: Math.abs(pull) });',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle knocks two discs four units before they touch',
    file: 'examples/settle.js',
    from: '            if (gap(f - 1, i, j) > 0 && gap(f, i, j) <= 0 && !(knock && knock.speed >= speed)) knock = { i, j, speed };',
    to: '            if (gap(f - 1, i, j) > 4 && gap(f, i, j) <= 4 && !(knock && knock.speed >= speed)) knock = { i, j, speed };',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle hears the softest meeting on a frame, not the hardest',
    file: 'examples/settle.js',
    from: '            if (gap(f - 1, i, j) > 0 && gap(f, i, j) <= 0 && !(knock && knock.speed >= speed)) knock = { i, j, speed };',
    to: '            if (gap(f - 1, i, j) > 0 && gap(f, i, j) <= 0 && !(knock && knock.speed <= speed)) knock = { i, j, speed };',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle hears every snap on a frame, so the opening is forty at once, a noise band',
    file: 'examples/settle.js',
    from: '        for (const { e, speed } of snaps.slice(0, BUSY)) {',
    to: '        for (const { e, speed } of snaps) {',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle hears a slack edge pulled fast as one coming taut',
    file: 'examples/settle.js',
    from: '          if (len(f, e) > REST && pull >= SNAP && before < SNAP && f - heard[e] > QUIET) snaps.push({ e, speed: pull });',
    to: '          if (pull >= SNAP && before < SNAP && f - heard[e] > QUIET) snaps.push({ e, speed: pull });',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
  },
  {
    why: 'settle snaps one edge on frame after frame, with no rest between',
    file: 'examples/settle.js',
    from: '          if (len(f, e) > REST && pull >= SNAP && before < SNAP && f - heard[e] > QUIET) snaps.push({ e, speed: pull });',
    to: '          if (len(f, e) > REST && pull >= SNAP && before < SNAP) snaps.push({ e, speed: pull });',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
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
    why: 'settle hears every event in the middle of the room, wherever it stands',
    file: 'examples/settle.js',
    from: '      const pan = WIDTH * Math.max(-1, Math.min(1, (ev.x - CX) / EX));',
    to: '      const pan = 0;',
    expect: 'settle: every sound is an event the picture shows, and the picture moves to its last frame',
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
    why: 'a voice connects its layers straight to its first filter or panner, so three add up in an order that changes',
    file: 'core/sound.js',
    from: '  sumInto(ctx, layers, chain[0]);',
    to: '  for (const l of layers) l.connect(chain[0]);',
    expect: 'voice builds a transient, a body of detuned partials and a tail, every input taking at most two',
  },
  {
    why: 'a voice partial stops at -60 dB instead of fading to silence, and clicks',
    file: 'core/sound.js',
    from: '    env.gain.linearRampToValueAtTime(0, gone + FADE);',
    to: '    env.gain.linearRampToValueAtTime(peak * QUIET, gone + FADE);',
    expect: 'voice partials fall to -60 dB, higher ones sooner, then fade out over 80 ms and stop',
  },
  {
    why: 'every partial of a voice dies together, whatever damp says',
    file: 'core/sound.js',
    from: '    const gone = top + fall / ratio ** damp;',
    to: '    const gone = top + fall;',
    expect: 'voice partials fall to -60 dB, higher ones sooner, then fade out over 80 ms and stop',
  },
  {
    why: 'every voice takes the same noise, so adding a voice is heard as a repeat',
    file: 'core/sound.js',
    from: '      data[i] = (2 * R(name, part, i) - 1)',
    to: "      data[i] = (2 * R('voice', part, i) - 1)",
    expect: 'voice noise comes from the seed and the name, and fades to nothing',
  },
  {
    why: 'a softer voice is only quieter, never darker',
    file: 'core/sound.js',
    from: ' * velocity ** (Math.max(0, ratio - 1) / 2);',
    to: ';',
    expect: 'voice velocity softens and darkens a sound, and vary makes each voice its own',
  },
  {
    why: 'every voice varies the same way, so repeated hits stay alike',
    file: 'core/sound.js',
    from: "  const dev = (k) => vary * (2 * R(name, 'vary', k) - 1);",
    to: "  const dev = (k) => vary * (2 * R('voice', 'vary', k) - 1);",
    expect: 'voice velocity softens and darkens a sound, and vary makes each voice its own',
  },
  {
    why: 'the room keeps its highs as it falls, so it never darkens',
    file: 'core/sound.js',
    from: '      const a = Math.exp((-2 * Math.PI * bright * (dark / bright) ** u) / rate);',
    to: '      const a = Math.exp((-2 * Math.PI * bright) / rate);',
    expect: 'room is a seeded convolver that falls to -60 dB and darkens as it falls',
  },
  {
    why: 'the room fills both sides from one noise, so it has no width',
    file: 'core/sound.js',
    from: '      y = (1 - a) * (2 * R(name, side, i) - 1) + a * y;',
    to: "      y = (1 - a) * (2 * R(name, 'left', i) - 1) + a * y;",
    expect: 'room is a seeded convolver that falls to -60 dB and darkens as it falls',
  },
  {
    why: 'a bend holds the pitch still, so a note never moves',
    file: 'core/sound.js',
    from: '        for (const [t, c] of bend) osc.detune.linearRampToValueAtTime(cents + apart + c, at + t);',
    to: '        for (const [t] of bend) osc.detune.linearRampToValueAtTime(cents + apart, at + t);',
    expect: 'voice bend glides the body through its points and vibrato swings it from its delay',
  },
  {
    why: 'vibrato swings only one copy of a detuned partial, so the copies beat apart',
    file: 'core/sound.js',
    from: '      if (swing) swing.connect(osc.detune);',
    to: '      if (swing && apart <= 0) swing.connect(osc.detune);',
    expect: 'voice bend glides the body through its points and vibrato swings it from its delay',
  },
  {
    why: 'vibrato starts with the note, not after its delay',
    file: 'core/sound.js',
    from: '    lfo.start(at + delay);',
    to: '    lfo.start(at);',
    expect: 'voice bend glides the body through its points and vibrato swings it from its delay',
  },
  {
    why: 'a sweep glides linearly in hertz, lingering in the highs',
    file: 'core/sound.js',
    from: '    for (const [t, hz] of sweep) f.frequency.exponentialRampToValueAtTime(hz, at + t);',
    to: '    for (const [t, hz] of sweep) f.frequency.linearRampToValueAtTime(hz, at + t);',
    expect: 'voice sweep and distance filter the whole voice, and distance takes up to 15 dB',
  },
  {
    why: 'a far voice is only half as much quieter',
    file: 'core/sound.js',
    from: ' * 10 ** (-0.75 * distance);',
    to: ' * 10 ** (-0.375 * distance);',
    expect: 'voice sweep and distance filter the whole voice, and distance takes up to 15 dB',
  },
  {
    why: 'a far voice keeps its highs',
    file: 'core/sound.js',
    from: '  if (distance > 0) chain.push(lowpass(',
    to: '  if (distance > 1) chain.push(lowpass(',
    expect: 'voice sweep and distance filter the whole voice, and distance takes up to 15 dB',
  },
  {
    why: 'the voice filters each feed the panner, skipping the ones after',
    file: 'core/sound.js',
    from: '  for (let k = 1; k < chain.length; k++) chain[k - 1].connect(chain[k]);',
    to: '  for (let k = 1; k < chain.length; k++) chain[k - 1].connect(place);',
    expect: 'voice sweep and distance filter the whole voice, and distance takes up to 15 dB',
  },
  {
    why: 'a near voice passes through air it does not cross, changing every existing soundtrack',
    file: 'core/sound.js',
    from: '  if (distance > 0) chain.push(lowpass(',
    to: '  if (distance >= 0) chain.push(lowpass(',
    expect: 'voice without bend, vibrato, sweep or distance builds the graph it did',
  },
  {
    why: 'a far sound is sent to the room like a near one, so distance is only quieter',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '      const far = c.ambience ? 0 : SEND + (1 - SEND) * (c.voice?.distance || 0);',
    to: '      const far = c.ambience ? 0 : SEND;',
    expect: 'the film scaffold sends a far sound more to the room unless its wet is given',
  },
  {
    why: 'the scaffold plays an ambience row as a voice',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '      const v = c.ambience ? ambience(ctx, R, c.name, at, c.ambience) : c.pluck ?',
    to: '      const v = c.ambience ? voice(ctx, R, c.name, at, c.ambience) : c.pluck ?',
    expect: 'the film scaffold plays an ambience row as a bed, out of the room unless its wet is given',
  },
  {
    why: 'the scaffold sends an ambience to the room like a near voice, so its bed takes the room twice',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '      const far = c.ambience ? 0 :',
    to: '      const far = c.ambience ? SEND :',
    expect: 'the film scaffold plays an ambience row as a bed, out of the room unless its wet is given',
  },
  {
    why: 'the scaffold lets an ambience run past the film, so the film cuts it at level',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (c.ambience && c.ambience.length * HZ > last - f + 1e-6) throw',
    to: '        if (false) throw',
    expect: "the film scaffold refuses an ambience past the film's end and fades the film's last 80 ms",
  },
  {
    why: 'the scaffold ends its film on a cut, so a voice still ringing clicks',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '    out.gain.linearRampToValueAtTime(0, timeline.duration);',
    to: '',
    expect: "the film scaffold refuses an ambience past the film's end and fades the film's last 80 ms",
  },
  {
    why: 'a looping film falls silent for 80 ms at every seam',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '    if (!timeline.loop) {',
    to: '    if (true) {',
    expect: "the film scaffold refuses an ambience past the film's end and fades the film's last 80 ms",
  },
  {
    why: 'a scaffold row with neither a voice nor an ambience fails on a TypeError about distance',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (!c.voice && !c.ambience && !c.pluck) throw',
    to: '        if (false) throw',
    expect: 'a sound given no spec object, or a scaffold row with no sound, is refused by name',
  },
  {
    why: 'a scaffold row with both a voice and an ambience plays only its ambience',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (c.voice && c.ambience) throw',
    to: '        if (false) throw',
    expect: 'a sound given no spec object, or a scaffold row with no sound, is refused by name',
  },
  {
    why: 'a scaffold row whose offscreen is an array, or a bare value, is read as a place and fails later on its side',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (c.offscreen != null && (typeof c.offscreen',
    to: '        if (false && (typeof c.offscreen',
    expect: 'the film scaffold lets a sound lead or trail its cause by the seconds it declares, and places a declared off-screen cause',
  },
  {
    why: 'the scaffold takes a beat with no intensity, so nothing marks the peak the strips are checked against',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (!(b.intensity >= 0 && b.intensity <= 1)) throw',
    to: '        if (false) throw',
    expect: 'the film scaffold puts each beat on its frame, finds the peak, and refuses a beat out of order, without an intensity or a changed state, or with an unknown knowledge',
  },
  {
    why: 'the scaffold takes a beat that changes no state, which is travel planned as a beat',
    file: 'skills/artifex/film-scaffold.cjs',
    from: "        if (typeof b.changes !== 'string' || !b.changes.trim()) throw",
    to: '        if (false) throw',
    expect: 'the film scaffold puts each beat on its frame, finds the peak, and refuses a beat out of order, without an intensity or a changed state, or with an unknown knowledge',
  },
  {
    why: 'the scaffold takes a beat on a thing the cue table has no row for, so what the story turns on is never tracked',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (!elements.some((e) => e.name === b.element)) throw',
    to: '        if (false) throw',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold takes a change of state the viewer never sees, made off screen',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (!elements.some((e) => e.name === b.element && shows(e, seen, seen))) {',
    to: '        if (false) {',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold takes a row that lists a shot it is never seen in',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '          if (!film.some((shot) => shot.name === name && shot.start < at.exit && at.enter < shot.end)) {',
    to: '          if (false) {',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: "the scaffold takes a state whose shots is a string, walking its characters as shot names, or a number, throwing a raw TypeError",
    file: 'skills/artifex/film-scaffold.cjs',
    from: '          listOf(state.shots, ',
    to: '          void (state.shots, ',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold takes a state whose shots list is empty, a state that is never shown',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '          if (!state.shots.length) throw new Error(',
    to: '          if (false) throw new Error(',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold takes a state that names a shot the film does not have, so a mistyped shot name passes',
    file: 'skills/artifex/film-scaffold.cjs',
    from: "            if (!plays.length) throw new Error(`element ${who}'s state",
    to: '            if (false) throw new Error(`element ${who}\'s state',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: "the scaffold takes a state shown in a shot outside its row's entry and exit, where the row is never seen",
    file: 'skills/artifex/film-scaffold.cjs',
    from: '            if (!plays.some((one) => one.start < at.exit && at.enter < one.end)) {',
    to: '            if (false) {',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: "the scaffold takes a state shown in a shot its row's own shots list leaves out, where the row is never drawn",
    file: 'skills/artifex/film-scaffold.cjs',
    from: '            if (e.shots && !e.shots.includes(shot)) throw new Error(',
    to: '            if (false) throw new Error(',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: "the scaffold takes a row whose shots is a string, walking its characters as shot names, or an empty string, drawing the row in every shot",
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        listOf(e.shots, ',
    to: '        void (e.shots, ',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold takes a row whose shots list is empty, where the row is never drawn',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (e.shots && !e.shots.length) throw new Error(',
    to: '        if (false) throw new Error(',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold counts a row as seen in shots it does not list, so a change there passes',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '(!e.shots || e.shots.includes(shot.name))',
    to: 'true',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold paints a row in shots it does not list, so the picture disagrees with the cue table',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '      if (e.shots && !e.shots.includes(shot)) continue;\n',
    to: '',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold names the first beat the peak, whatever its intensity',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '(a, b) => (a && a.intensity >= b.intensity ? a : b)',
    to: '(a, b) => (a || b)',
    expect: 'the film scaffold puts each beat on its frame, finds the peak, and refuses a beat out of order, without an intensity or a changed state, or with an unknown knowledge',
  },
  {
    why: 'the scaffold lets a question go unanswered, so the film raises what it never pays off',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '      if (open.size) throw',
    to: '      if (false) throw',
    expect: 'the film scaffold answers every question a beat asks except the one left open, and refuses what rises without rising',
  },
  {
    why: 'the scaffold lets a beat answer a question nobody asked',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '          if (!open.delete(q)) throw',
    to: '          if (!open.delete(q) && false) throw',
    expect: 'the film scaffold answers every question a beat asks except the one left open, and refuses what rises without rising',
  },
  {
    why: 'the scaffold lets the escalation fall back',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '&& b.rise > rise))',
    to: '&& b.rise >= -Infinity))',
    expect: 'the film scaffold answers every question a beat asks except the one left open, and refuses what rises without rising',
  },
  {
    why: 'the scaffold lets the eye jump across the frame at a cut',
    file: 'skills/artifex/film-scaffold.cjs',
    from: ' > W / 3) {',
    to: ' > W) {',
    expect: 'the film scaffold keeps the eye within a third of the frame across a cut unless the later shot is a jolt',
  },
  {
    why: 'the scaffold refuses a jolt, so a heavy beat cannot jump the eye on purpose',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (from && to && !to.jolt && ',
    to: 'if (from && to && ',
    expect: 'the film scaffold keeps the eye within a third of the frame across a cut unless the later shot is a jolt',
  },
  {
    why: 'the scaffold measures where the eye lands in design units, so a cut whose camera pans the eye far passes',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const land = to && onScreen(viewAt(camera, film[i].start), to.in);',
    to: 'const land = to && to.in;',
    expect: 'the film scaffold measures the eye\'s jump across a cut on screen, through the camera on the frames either side of it',
  },
  {
    why: 'the scaffold maps where the eye leaves through the next shot\'s framing, so a camera cut on the shot cut hides the jump',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'onScreen(viewAt(camera, film[i].start - 1), from.out)',
    to: 'onScreen(viewAt(camera, film[i].start), from.out)',
    expect: 'the film scaffold measures the eye\'s jump across a cut on screen, through the camera on the frames either side of it',
  },
  {
    why: 'the scaffold maps the eye through the framing after a camera cut inside a shot on both sides, so the framing can jump the eye',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const before = onScreen(viewAt(camera, c.frame - 1), p);',
    to: 'const before = onScreen(viewAt(camera, c.frame), p);',
    expect: 'the film scaffold measures the eye\'s jump at a camera cut inside a shot',
  },
  {
    why: 'the scaffold measures the point between the shot\'s in and out at the camera cut\'s place in the shot, not its in alone',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];',
    to: 'const p = a;',
    expect: 'the film scaffold measures the eye\'s jump at a camera cut inside a shot',
  },
  {
    why: 'the scaffold takes a beat in the first frames after a cut, while the eye is still finding the shot',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (cut) throw',
    to: '        if (false) throw',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold counts 6 frames after a cut at any rate, so at 60 fps a beat 14 frames in passes',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const settle = Math.ceil((6 * HZ) / 24);',
    to: 'const settle = 6;',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold takes a beat just after a camera cut of the framing, which the eye must find as it finds a new shot',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        ...camera.flatMap((k, j) => j > 0 && k.frame === camera[j - 1].frame',
    to: '        ...camera.flatMap((k, j) => false && k.frame === camera[j - 1].frame',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold lets two camera keys on frame 0 pass silently, though the cut list skips frame 0 and only one shows',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'i > 0 && (k.at !== CAMERA[i - 1].at || at.frame === 0) && at.frame',
    to: 'i > 0 && k.at !== CAMERA[i - 1].at && at.frame',
    expect: 'the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists',
  },
  {
    why: 'the scaffold names the first cut a beat falls after, so moving it past that one lands it after the next',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'at.frame < c.frame + settle).reduce((a, c) => (a && a.frame >= c.frame ? a : c), null);',
    to: 'at.frame < c.frame + settle).reduce((a, c) => (a || c), null);',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold takes a jolt straight after a cut, so the eye jumps before it has landed',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (cut) {',
    to: '        if (false) {',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold counts the film\'s first frame as a cut, so a jolt from a short opening shot is refused',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '[...film.slice(1).map(',
    to: '[...film.map(',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold counts only cuts between shots before a jolt, so a jolt just after a camera cut passes',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'cuts.filter((c) => c.frame < film[i].start',
    to: 'cuts.filter((c) => c.shot && c.frame < film[i].start',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold takes a camera cut inside a jolt shot\'s first frames, so the framing jumps while the jolt still lands',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        if (late) {',
    to: '        if (false) {',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold counts only camera cuts after a jolt, so a jolt shot shorter than its settle frames cuts away before the jolt lands',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'cuts.find((c) => film[i].start < c.frame',
    to: 'cuts.find((c) => !c.shot && film[i].start < c.frame',
    expect: 'the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate',
  },
  {
    why: 'the scaffold takes a keys track that is not keys, so paint fails on it frames later',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '          try { keys(list); } catch (error) { throw',
    to: '          try { keys([[0, 0]]); } catch (error) { throw',
    expect: 'the film scaffold warns when every keys track of an element shares its frames, or two tracks carry the same keys',
  },
  {
    why: 'the scaffold stays quiet when every part of a figure keys on the same frames',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (tracks.length > 1 && tracks.every(',
    to: 'if (false && tracks.every(',
    expect: 'the film scaffold warns when every keys track of an element shares its frames, or two tracks carry the same keys',
  },
  {
    why: 'the scaffold stays quiet when two parts carry the same keys',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (same(one, two)) console.warn',
    to: 'if (false) console.warn',
    expect: 'the film scaffold warns when every keys track of an element shares its frames, or two tracks carry the same keys',
  },
  {
    why: 'the scaffold leaves retimed keys between frames, so a switch shows a frame after its beat and sound',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const to = frame(retime(f / HZ));',
    to: 'const to = retime(f / HZ) * HZ;',
    expect: 'the film scaffold rounds retimed keys to a whole frame as it rounds beats and sounds, and refuses two keys that round to one frame',
  },
  {
    why: 'the scaffold stays quiet about a cut in a row\'s keys with neither a beat nor a sound on its frame',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '            if (!shows(e, f, f)) continue;',
    to: '            continue;',
    expect: 'the film scaffold warns when a cut in a row\'s keys has neither a beat on the row nor a sound the row causes on its frame',
  },
  {
    why: 'the scaffold stays quiet about a cut on the first frame a row is seen on',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '            if (!shows(e, 0, f - 1) && !named(e.name, start ? 0 : f - 1, f - 1)) {',
    to: '            if (false) {',
    expect: 'the film scaffold warns of a cut on the first frame a row is seen on, frame 0 included, and not on a row returning in a later shot',
  },
  {
    why: 'the scaffold stays quiet about a keyed value that jumps across a layer change',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const jumps = handed && ',
    to: 'const jumps = false && handed && ',
    expect: 'the film scaffold judges a keys cut across a layer change by name, not by row',
  },
  {
    why: 'the scaffold warns of a takeover row\'s own cut on its enter frame although the shown value carries over',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'cutsOn.filter((f) => !(takeover && f === e.enter))',
    to: 'cutsOn',
    expect: 'the film scaffold judges a keys cut across a layer change by name, not by row',
  },
  {
    why: 'the scaffold compares the rate of a key that starts a hold, though lerp(v, v, rate(u)) is v',
    file: 'skills/artifex/film-scaffold.cjs',
    from: ' || one[k + 1][1] === v || r ===',
    to: ' || r ===',
    expect: 'the film scaffold warns when every keys track of an element shares its frames, or two tracks carry the same keys',
  },
  {
    why: 'the scaffold compares the rate of a key cut on its frame, which shapes no move',
    file: 'skills/artifex/film-scaffold.cjs',
    from: ' || one[k + 1][0] === f || ',
    to: ' || ',
    expect: 'the film scaffold warns when every keys track of an element shares its frames, or two tracks carry the same keys',
  },
  {
    why: 'the scaffold compares the last key\'s rate, which shapes no move',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '&& (k === one.length - 1 || one[k + 1][0] === f',
    to: '&& (k === one.length - 1 ? r === (two[k][2] ?? ease.linear) : one[k + 1][0] === f',
    expect: 'the film scaffold warns when every keys track of an element shares its frames, or two tracks carry the same keys',
  },
  {
    why: 'the scaffold ignores rates in the twins comparison, so two parts that differ only in easing are warned of',
    file: 'skills/artifex/film-scaffold.cjs',
    from: ' || r === (two[k][2] ?? ease.linear)));',
    to: ' || true));',
    expect: 'the film scaffold warns when every keys track of an element shares its frames, or two tracks carry the same keys',
  },
  {
    why: 'the scaffold takes two keys written on one frame before the film, so the first never plays',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '(f !== list[i - 1][0] || to < 0)',
    to: '(f !== list[i - 1][0])',
    expect: 'the film scaffold warns of keys as they play: rounded frames, a cut whose earlier value was seen, once a frame',
  },
  {
    why: 'a voice given null for its spec fails on a destructuring TypeError that names nothing',
    file: 'core/sound.js',
    from: "  const who = `voice ${name}`;\n  group(who, 'spec', spec);",
    to: '  const who = `voice ${name}`;',
    expect: 'a sound given no spec object, or a scaffold row with no sound, is refused by name',
  },
  {
    why: 'a refusal of a Symbol throws while writing its own message',
    file: 'core/sound.js',
    from: "got ${Array.isArray(v) ? 'a list' : String(v)}",
    to: "got ${Array.isArray(v) ? 'a list' : v}",
    expect: 'a sound given no spec object, or a scaffold row with no sound, is refused by name',
  },
  {
    why: 'a sound given null for a group of keys fails on a TypeError that names neither the sound nor the key',
    file: 'core/sound.js',
    from: "  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw",
    to: '  if (false) throw',
    expect: 'voice and ambience refuse a group of keys that is not an object, naming the sound and the key',
  },
  {
    why: 'an ambience grain computes 80 ms of sine after -60 dB again',
    file: 'core/sound.js',
    from: '    const lastN = ringN + Math.ceil(GRAIN_FADE * sr);',
    to: '    const lastN = ringN + Math.ceil(FADE * sr);',
    expect: 'ambience grains are seeded events in the band that rise as they close, fall to -60 dB and fade out over 5 ms',
  },
  {
    why: 'both sides of an ambience take the same noise, so it sounds from one point',
    file: 'core/sound.js',
    from: '      let y = 2 * R(name, side, i) - 1;',
    to: "      let y = 2 * R(name, 'left', i) - 1;",
    expect: 'ambience is a seeded bed, its own noise each side, at its level and colour, rising from and falling to silence',
  },
  {
    why: 'an ambience band spreads over the whole spectrum, a hiss',
    file: 'core/sound.js',
    from: '  const k = (2 ** band - 1) / 2 ** (band / 2) / Math.sqrt(Math.SQRT2 - 1);',
    to: '  const k = 8;',
    expect: 'ambience is a seeded bed, its own noise each side, at its level and colour, rising from and falling to silence',
  },
  {
    why: 'an ambience starts and stops on a cut',
    file: 'core/sound.js',
    from: '  const faded = (i) => (i >= fadeN && n - 1 - i >= fadeN ? 1 :',
    to: '  const faded = (i) => (true ? 1 :',
    expect: 'ambience is a seeded bed, its own noise each side, at its level and colour, rising from and falling to silence',
  },
  {
    why: 'an ambience level is its noise level, not its RMS',
    file: 'core/sound.js',
    from: '    const scale = power > 0 ? level / Math.sqrt(power / n) : 0;',
    to: '    const scale = power > 0 ? level : 0;',
    expect: 'ambience is a seeded bed, its own noise each side, at its level and colour, rising from and falling to silence',
  },
  {
    why: 'an ambience level never wanders',
    file: 'core/sound.js',
    from: '        gain = 10 ** (0.3 * drift * wander(1 + c, i));',
    to: '        gain = 1;',
    expect: 'ambience is a seeded bed, its own noise each side, at its level and colour, rising from and falling to silence',
  },
  {
    why: 'an ambience event holds its pitch as it closes',
    file: 'core/sound.js',
    from: '        if (i < ringN) { hz *= step; env *= fall; }',
    to: '        if (i < ringN) env *= fall;',
    expect: 'ambience grains are seeded events in the band that rise as they close, fall to -60 dB and fade out over 5 ms',
  },
  {
    why: 'an ambience event stops at -60 dB instead of fading out',
    file: 'core/sound.js',
    from: '(i <= ringN ? 1 : 1 - (i - ringN) / (lastN - ringN))',
    to: '(i <= ringN ? 1 : 1)',
    expect: 'ambience grains are seeded events in the band that rise as they close, fall to -60 dB and fade out over 5 ms',
  },
  {
    why: 'an ambience grain rises over half a millisecond, so a short grain peaks louder than the API documents',
    file: 'core/sound.js',
    from: '    const riseN = Math.ceil(0.001 * sr);',
    to: '    const riseN = Math.ceil(0.0005 * sr);',
    expect: 'an ambience grain peaks under its level as its 1 ms rise meets its fall, by what the API documents',
  },
  {
    why: 'every ambience event lands on the left',
    file: 'core/sound.js',
    from: '        right[start + i] += r * v;',
    to: '        right[start + i] += l * v;',
    expect: 'ambience grains are seeded events in the band that rise as they close, fall to -60 dB and fade out over 5 ms',
  },
  {
    why: 'the film scaffold accepts an element that never exits',
    file: 'skills/artifex/film-scaffold.cjs',
    from: "        if (e.exit == null) throw new Error(`element ${who} has no exit`);",
    to: '',
    expect: 'the film scaffold puts entries, exits and sounds on whole frames and refuses what has no exit or cause',
  },
  {
    why: 'the film scaffold accepts a sound whose cause is not on screen',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '} else if (!alive(c.cause, f - (trail > 0 ? frame(trail) + 1 : 0), f + frame(lead))) {',
    to: '} else if (false) {',
    expect: 'the film scaffold puts entries, exits and sounds on whole frames and refuses what has no exit or cause',
  },
  {
    why: 'the film scaffold paints an element on its exit frame',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '      if (f < e.enter || f >= e.exit || !PAINT[e.name]) continue;',
    to: '      if (f < e.enter || f > e.exit || !PAINT[e.name]) continue;',
    expect: 'the film scaffold puts entries, exits and sounds on whole frames and refuses what has no exit or cause',
  },
  {
    why: 'the film scaffold connects every room send straight to the room',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '    for (const [place, hall] of halls) sumInto(ctx, [...sends.get(place), ...under(musicSends.get(place))], hall);',
    to: '    for (const [place, hall] of halls) for (const x of [...sends.get(place), ...under(musicSends.get(place))]) x.connect(hall);',
    expect: 'the film scaffold puts entries, exits and sounds on whole frames and refuses what has no exit or cause',
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
    why: 'settle connects every event\'s voice to its dry bus again, so Edge adds them in a changing order',
    file: 'examples/settle.js',
    from: '    sumInto(ctx, voices, dry);',
    to: '    for (const v of voices) v.connect(dry);',
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
    from: "      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || performance.now() >= deadline) throw error;",
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
    why: 'a browser stop gives up on the owned Edge before its limit',
    file: 'tools/check-browser.js',
    from: '    delay(Math.max(0, deadline - performance.now()), false,',
    to: '    delay(Math.max(0, deadline - performance.now() - 20), false,',
    expect: 'browser stop waits for the owned Edge to exit and fails while it keeps running',
  },
  {
    why: 'teardown gives up on a suite process before its grace period ends',
    file: 'tests/negative.js',
    from: '      }, grace' + 'Ms);',
    to: '      }, graceMs - 20);',
    expect: 'owned teardown is judged by its own process, never by the kill command',
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
    from: '      try { await removeCopy(dir); await removeCopy(dir + SUITE_TEMP); } ' + 'catch (error) {',
    to: '      if (false) try { await removeCopy(dir); await removeCopy(dir + SUITE_TEMP); } catch (error) {',
    expect: 'the runner holds at most one mutated copy at a time and kept evidence survives each removal',
  },
  {
    why: 'every mutation runs the whole suite although the control found its expected test\'s file',
    file: 'tests/negative.js',
    from: 'own ? [own] : ' + 'undefined);',
    to: 'undefined);',
    expect: 'each mutation runs the file of its expected test, and the whole suite when that file misses',
  },
  {
    why: 'a test file that fails on its own still runs alone, so its failure passes for a catch',
    file: 'tests/negative.js',
    from: '      if (!alone.failure && !alone.failed.length) ' + 'continue;',
    to: '      continue;',
    expect: 'each mutation runs the file of its expected test, and the whole suite when that file misses',
  },
  {
    why: 'a title the control reported twice runs only the last file that holds it',
    file: 'tests/negative.js',
    from: 'files.has(name) || ' + 'typeof file',
    to: 'typeof file',
    expect: 'each mutation runs the file of its expected test, and the whole suite when that file misses',
  },
  {
    why: 'a mutated copy runs the control\'s test file instead of its own',
    file: 'tests/negative.js',
    from: 'null : path.relative(dir, file)' + '.replace(',
    to: 'null : file.replace(',
    expect: 'each mutation runs the file of its expected test, and the whole suite when that file misses',
  },
  {
    why: 'a miss in the expected test\'s file is reported without the whole suite, so a catch by another file reads as an escape',
    file: 'tests/negative.js',
    from: 'if (files !== SUITE && ' + "(verdict === 'escaped'",
    to: "if (false && (verdict === 'escaped'",
    expect: 'each mutation runs the file of its expected test, and the whole suite when that file misses',
  },
  {
    why: 'the report-only retry of an infrastructure result on one file runs the whole suite',
    file: 'tests/negative.js',
    from: 'const again = await runSuite(dir, execute, timeoutMs, ' + 'files);',
    to: 'const again = await runSuite(dir, execute, timeoutMs);',
    expect: 'each mutation runs the file of its expected test, and the whole suite when that file misses',
  },
  {
    why: 'the browser check leaves one example that declares sound without a film',
    file: 'tools/check-browser.js',
    from: '  const sounding = examples.filter((example) => example.sound);',
    to: '  const sounding = examples.filter((example) => example.sound).slice(1);',
    expect: 'the browser check exports a film for every example that declares sound, else the first with a timeline, and the first with a box timeline',
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
    from: "    && sheet.cells.every((cell) => cell.error !== null || typeof cell.markCount === 'number')\n",
    to: '    && true\n',
    expect: 'a sheet image waits until every planned cell has rendered or failed',
  },
  {
    why: 'a reference photo over the size budget is accepted',
    file: 'tests/style-references.test.js',
    from: '      if (bytes.length > BUDGET) problems.push(',
    to: '      if (bytes.length > BUDGET * 10) problems.push(',
    expect: 'style references: an oversized, unrecorded or unlisted photo is named',
  },
  {
    why: 'a reference photo under a licence that restricts publishing is accepted',
    file: 'tests/style-references.test.js',
    from: "const LICENCES = ['owner', 'CC0-1.0', 'public-domain'];",
    to: "const LICENCES = ['owner', 'CC0-1.0', 'public-domain', 'CC-BY-4.0'];",
    expect: 'style references: an oversized, unrecorded or unlisted photo is named',
  },
  {
    why: 'the reference photo stays above the strip instead of beside its crops',
    file: 'tools/contact-sheet.js',
    from: '    if (photo) sheet.appendChild(photo);',
    to: '    if (photo) out.appendChild(photo);',
    expect: 'contact sheet: --reference shows a photo at its centre, pixel for pixel, the size of a 100% crop',
  },
  {
    why: 'a --sound strip solves its piece again for the soundtrack, so a piece whose build is its film pays it twice',
    file: 'tools/contact-sheet.js',
    from: 'return render.renderSound(p, build.solved);',
    to: 'return render.renderSound(p, piece.solve(p, STRIP.seed));',
    expect: 'contact sheet: cells at one seed and params share one build, timed once, so a piece whose build is its film is solved once a strip',
  },
  {
    why: 'a strip cell no longer carries the shot its frame falls in',
    file: 'tools/contact-sheet.js',
    from: '...(own && { shot: own.name }), ',
    to: '',
    expect: 'contact sheet: strip cells carry the shot their frame falls in whenever the piece keeps a shot list',
  },
  {
    why: 'a strip measures the change between two cells either side of a cut',
    file: 'tools/contact-sheet.js',
    from: ' || last.shot !== cell.shot',
    to: '',
    expect: 'contact sheet: a strip measures no change, hold or light across a cut, on --at and --shots strips alike',
  },
  {
    why: 'a strip hold runs on across a cut into the next shot',
    file: 'tools/contact-sheet.js',
    from: 'while (drawn(from) && drawn(to + 1) && !opensRun(cells, to + 1)) {',
    to: 'while (drawn(from) && drawn(to + 1)) {',
    expect: 'contact sheet: a strip measures no change, hold or light across a cut, on --at and --shots strips alike',
  },
  {
    why: 'a strip measures the change across a contact row start, between cells that are not neighbours',
    file: 'tools/contact-sheet.js',
    from: 'result.change = after && !opens ? gridChange',
    to: 'result.change = after ? gridChange',
    expect: 'contact sheet: a --contacts strip breaks change and hold at each contact\'s row, and its light at a cut inside a row',
  },
  {
    why: 'a cell that opens a contact\'s row opens no run, so a hold runs on from one contact into the next',
    file: 'tools/contact-sheet.js',
    from: ' || last.contact !== cell.contact',
    to: '',
    expect: 'contact sheet: a --contacts strip breaks change and hold at each contact\'s row, and its light at a cut inside a row',
  },
  {
    why: 'a shot list that names two shots alike is read instead of refused',
    file: 'tools/contact-sheet.js',
    from: '  if (twice >= 0) throw refuse(`state.cues.shots entry',
    to: '  if (twice < -1) throw refuse(`state.cues.shots entry',
    expect: 'contact sheet: shotList refuses a shot list that names two shots alike, by index and name',
  },
  {
    why: 'the strip page plans the strip again instead of taking the layout seeds already planned',
    file: 'tools/contact-sheet.js',
    from: 'const layout = strip && (planned || planStrip(',
    to: 'const layout = strip && (planStrip(',
    expect: 'contact sheet: a seeds run builds the piece once for a --frames, --contacts or --shots strip and its page',
  },
  {
    why: 'seeds hands its planned layout no further, so the page builds the piece again',
    file: 'tools/contact-sheet.js',
    from: 'soundReference || null, !!args.lightPage, layout);',
    to: 'soundReference || null, !!args.lightPage);',
    expect: 'contact sheet: a seeds run builds the piece once for a --frames, --contacts or --shots strip and its page',
  },
  {
    why: 'a --contacts strip builds the piece again to read its contacts',
    file: 'tools/contact-sheet.js',
    from: 'contacts = contactList(p, strip.contacts, seed, state);',
    to: 'contacts = contactList(p, strip.contacts, seed);',
    expect: 'contact sheet: a seeds run builds the piece once for a --frames, --contacts or --shots strip and its page',
  },
  {
    why: 'a plain strip of a piece whose state() throws refuses instead of drawing its failed cells',
    file: 'tools/contact-sheet.js',
    from: '    state = s.stages.error ? null : s.state;',
    to: '    state = builtState(p, \'seeds\', seed);',
    expect: 'contact sheet: a --frames strip of a piece whose state() throws plans its cells and writes its page, so the page draws them failed',
  },
  {
    why: 'the style gap counts a photo crop\'s blank margin as white',
    file: 'tools/contact-sheet.js',
    from: '    if (!alpha) continue;\n',
    to: '',
    expect: 'contact sheet: styleStats skips transparent pixels, and lays a partly transparent one over white',
  },
  {
    why: 'the style gap adds the colour bins\' differences without halving them, so it no longer runs from 0 to 1',
    file: 'tools/contact-sheet.js',
    from: 'return both ? round(s / 2) : null;',
    to: 'return both ? round(s) : null;',
    expect: 'contact sheet: styleGap reports each part and the colour bins that differ most, with no weight or total',
  },
  {
    why: '--reference is taken without the 100% crops it is compared with',
    file: 'tools/contact-sheet.js',
    from: "  if (reference !== null && loupe === null) throw refuse(",
    to: "  if (false) throw refuse(",
    expect: 'contact sheet: --reference shows a photo at its centre, pixel for pixel, the size of a 100% crop',
  },
  {
    why: 'the sheet image is taken before its reference photo has loaded',
    file: 'tools/check-browser.js',
    from: '    && Array.from(window.document ? window.document.images : []).every((image) => image.complete);',
    to: '    && true;',
    expect: 'contact sheet: --json waits for window.__sheet, sound and all, and reads it as plain data with its failures counted',
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
    why: 'strip detail is measured at full size, so fine hatching with no subject passes for a rich frame',
    file: 'tools/contact-sheet.js',
    from: '  const B = Math.max(1, Math.round(width / 80)), w = Math.max(1, Math.floor(width / B)), h = Math.max(1, Math.floor(height / B));',
    to: '  const B = 1, w = Math.max(1, Math.floor(width / B)), h = Math.max(1, Math.floor(height / B));',
    expect: "contact sheet: a strip frame's detail is measured in blocks 1/80 of the cell wide, so fine hatching with no subject reads as flat",
  },
  {
    why: 'a strip compares a frame only with its next neighbours, so a blank shown on two frames in a row is missed',
    file: 'tools/contact-sheet.js',
    from: '      : cell.detail < rules.dip * Math.min(most(0, i), most(i + 1, cells.length)) ? \'dip\' : null;',
    to: '      : cell.detail < rules.dip * Math.min(most(i - 1, i), most(i + 1, i + 2)) ? \'dip\' : null;',
    expect: 'contact sheet: a strip flags a frame nearly empty under the floor or far under the most detailed frame on each side',
  },
  {
    why: 'a strip no longer reports a flat frame at its start or end, which has no richer frame on both sides',
    file: 'tools/contact-sheet.js',
    from: '    const why = cell.detail < rules.floor ? \'floor\'',
    to: '    const why = false ? \'floor\'',
    expect: 'contact sheet: a strip flags a frame nearly empty under the floor or far under the most detailed frame on each side',
  },
  {
    why: 'measureFrame no longer counts marks after ctx.reset()',
    file: 'tools/contact-sheet.js',
    from: "          else if (key === 'reset') { kept.length = 0; reset = true; }",
    to: "          else if (key === 'reset') { kept.length = 0; }",
    expect: "contact sheet: measureFrame counts marks after reset() or a restore() past the cell's save, clears a reset that restore() undoes, and reads the transform only at transform calls",
  },
  {
    why: "a restore() that pops the cell's save no longer drops the scale",
    file: 'tools/contact-sheet.js',
    from: '            if (kept.length) { reset = kept.pop(); if (!kept.length) reset = after = true; }',
    to: '            if (kept.length) { reset = kept.pop(); }',
    expect: "contact sheet: measureFrame counts marks after reset() or a restore() past the cell's save, clears a reset that restore() undoes, and reads the transform only at transform calls",
  },
  {
    why: 'a restore() no longer undoes a reset made after its save',
    file: 'tools/contact-sheet.js',
    from: '            if (kept.length) { reset = kept.pop(); if (!kept.length) reset = after = true; }',
    to: '            if (kept.length) { kept.pop(); if (!kept.length) reset = after = true; }',
    expect: "contact sheet: measureFrame counts marks after reset() or a restore() past the cell's save, clears a reset that restore() undoes, and reads the transform only at transform calls",
  },
  {
    why: 'measureFrame reads the transform at every mark again',
    file: 'tools/contact-sheet.js',
    from: '          if (!done && reset && flat && PAINT[key] !== null) { if (after) pending++; else unscaled++; }',
    to: '          if (!done && reset && PAINT[key] !== null && (target.getTransform(), flat)) { if (after) pending++; else unscaled++; }',
    expect: "contact sheet: measureFrame counts marks after reset() or a restore() past the cell's save, clears a reset that restore() undoes, and reads the transform only at transform calls",
  },
  {
    why: "marks painted after the cell's closing restore(), such as a finish's, count as unscaled again",
    file: 'tools/contact-sheet.js',
    from: '          if (!done && reset && flat && PAINT[key] !== null) { if (after) pending++; else unscaled++; }',
    to: '          if (!done && reset && flat && PAINT[key] !== null) unscaled++;',
    expect: "contact sheet: measureFrame counts marks after reset() or a restore() past the cell's save, clears a reset that restore() undoes, and reads the transform only at transform calls",
  },
  {
    why: 'measureFrame tracks saves, restores and transforms after the count ended',
    file: 'tools/contact-sheet.js',
    from: '        if (track && !done) {',
    to: '        if (track) {',
    expect: "contact sheet: measureFrame counts marks after reset() or a restore() past the cell's save, clears a reset that restore() undoes, and reads the transform only at transform calls",
  },
  {
    why: 'a strip no longer lists a cell drawn unscaled',
    file: 'tools/contact-sheet.js',
    from: '    if (cell.unscaled) unscaled.push({ ...pick(cell, i), marks: cell.unscaled });',
    to: '    if (false) unscaled.push({ ...pick(cell, i), marks: cell.unscaled });',
    expect: "contact sheet: a strip flags a cell unscaled on its own line when its draw resets the cell's scale, but not a device-pixel copy or a cell at scale 1",
  },
  {
    why: 'a hold is judged step by step, so a slow change that never pauses reads as held',
    file: 'tools/contact-sheet.js',
    from: '      cells[to + 1].hold = change(soft[from], soft[to + 1]);',
    to: '      cells[to + 1].hold = change(soft[to], soft[to + 1]);',
    expect: 'contact sheet: a strip reports frames held against the first of them for holdSeconds or more',
  },
  {
    why: 'a hold is judged by the mean change over the frame, so a figure breathing in a held pose reads as held',
    file: 'tools/contact-sheet.js',
    from: 's = Math.max(1, Math.round(bw / 10));',
    to: 's = Math.max(bw, bh);',
    expect: 'contact sheet: a hold that breathes in one small region is not held, and a frozen one is, under grain, weave and flicker too',
  },
  {
    why: 'a hold is judged by the single block that changed most, so a finish\'s grain breaks a frozen hold',
    file: 'tools/contact-sheet.js',
    from: 's = Math.max(1, Math.round(bw / 10));',
    to: 's = 1;',
    expect: 'contact sheet: a hold that breathes in one small region is not held, and a frozen one is, under grain, weave and flicker too',
  },
  {
    why: 'a hold allows no shift of the whole picture, so a finish\'s weave breaks a frozen hold',
    file: 'tools/contact-sheet.js',
    from: '    const { w, h, block: k } = a, A = a.data, m = k / 4, S = scratch(w * h);',
    to: '    const { w, h, block: k } = a, A = a.data, m = 0, S = scratch(w * h);',
    expect: 'contact sheet: a hold that breathes in one small region is not held, and a frozen one is, under grain, weave and flicker too',
  },
  {
    why: 'a hold allows no gain of the whole picture, so a finish\'s flicker breaks a frozen hold on a light ground',
    file: 'tools/contact-sheet.js',
    from: '      return aa > 0 ? Math.max(0.97, Math.min(1.03, ab / aa)) : 1;',
    to: '      return 1;',
    expect: 'contact sheet: a hold that breathes in one small region is not held, and a frozen one is, under grain, weave and flicker too',
  },
  {
    why: 'a hold compares the lumas unblurred, so a frozen grid of fine lines off whole pixels under weave breaks the hold',
    file: 'tools/contact-sheet.js',
    from: '    for (let pass = 0; pass < 8; pass++) {',
    to: '    for (let pass = 0; pass < 0; pass++) {',
    expect: 'contact sheet: a hold that breathes in one small region is not held, and a frozen one is, under grain, weave and flicker too',
  },
  {
    why: 'a hold of exactly holdSeconds is not reported',
    file: 'tools/contact-sheet.js',
    from: '    if (to > from && seconds >= rules.holdSeconds) holds.push(',
    to: '    if (to > from && seconds > rules.holdSeconds) holds.push(',
    expect: 'contact sheet: a strip reports frames held against the first of them for holdSeconds or more',
  },
  {
    why: 'the strip computes its flags but window.__sheet does not carry them',
    file: 'tools/contact-sheet.js',
    from: '    flags: flags, failures: function () {',
    to: '    failures: function () {',
    expect: 'contact sheet: a strip page draws its flags into window.__sheet and onto the sheet',
  },
  {
    why: 'a lit area takes the darkest block as its ground, so grain over the whole frame pulls the centre of a dim light toward the middle',
    file: 'tools/contact-sheet.js',
    from: 'function litArea(d) {\n  const ground = Float64Array.from(d.grid).sort()[d.grid.length >> 1];',
    to: 'function litArea(d) {\n  const ground = Math.min(...d.grid);',
    expect: 'contact sheet: litArea follows a dim light moving across a dark ground and holds still under drift, flicker, weave and grain, where the whole-frame change cannot tell them apart',
  },
  {
    why: 'a cell that opens a shot compares its light with the shot before, so the cut reads as a moving light',
    file: 'tools/contact-sheet.js',
    from: 'before = after && !opens && last.light',
    to: 'before = after && last.light',
    expect: 'contact sheet: a --shots strip does not compare the light of a cell that opens a shot with the shot before it',
  },
  {
    why: 'a cell after a failed cell compares its light with the failed one',
    file: 'tools/contact-sheet.js',
    from: 'before = after && ',
    to: 'before = prev && ',
    expect: 'contact sheet: a strip does not compare the light of a cell that follows a failed cell, or that opens a shot whose name the shot before shares',
  },
  {
    why: 'a strip trusts a cell it never measured, so holds and beats count a frame with no luma',
    file: 'tools/contact-sheet.js',
    from: 'cells[i].error === null && !!lumas[i]',
    to: 'cells[i].error === null',
    expect: 'contact sheet: beatSummary and stripFlags trust the same cells, so a cell with no luma counts no change and breaks a hold',
  },
  {
    why: 'a strip measures the change of a cell after a failed cell from the failed frame',
    file: 'tools/contact-sheet.js',
    from: 'result.change = after && !opens',
    to: 'result.change = prev && !opens',
    expect: 'contact sheet: a strip does not compare the light of a cell that follows a failed cell, or that opens a shot whose name the shot before shares',
  },
  {
    why: 'beatSummary counts the change of a raw cell measured from a failed cell',
    file: 'tools/contact-sheet.js',
    from: ' && (!k || trust[k - 1])',
    to: '',
    expect: 'contact sheet: beatSummary ignores the change of a raw cell that follows a failed cell',
  },
  {
    why: 'a light that moves exactly the share of the width reads as held',
    file: 'tools/contact-sheet.js',
    from: 'move >= rules.lightMove * width) &&',
    to: 'move > rules.lightMove * width) &&',
    expect: "contact sheet: a strip's light flag judges each run of one shot by its lowest and highest level and largest move, broken at a shot's first cell and a failed cell",
  },
  {
    why: 'a cell with no light is skipped, so a lamp that switches off and back on keeps its lowest level',
    file: 'tools/contact-sheet.js',
    from: '        low = Math.min(low, level);',
    to: '        if (lit) low = Math.min(low, level);',
    expect: "contact sheet: a strip's light flag judges each run of one shot by its lowest and highest level and largest move, broken at a shot's first cell and a failed cell",
  },
  {
    why: 'light runs do not break at a cell marked first, so two shots of one name are judged as one',
    file: 'tools/contact-sheet.js',
    from: "!last || cell.mark === 'first' || ",
    to: '!last || ',
    expect: "contact sheet: a strip's light flag judges each run of one shot by its lowest and highest level and largest move, broken at a shot's first cell and a failed cell",
  },
  {
    why: 'the light flag measures no region, so a small lamp switching off beside a brighter static area reads as held',
    file: 'tools/contact-sheet.js',
    from: '      if (dim !== null) dim = +dim.toFixed(3);',
    to: '      dim = null;',
    expect: 'contact sheet: on fixtures/light-film.cjs a --shots strip reports the light held only in its drift shot, counting a null light as 0 and catching a small lamp beside a brighter static area by its region',
  },
  {
    why: 'the light flag compares the first and last cells, so a switch that turns back within the shot keeps its level',
    file: 'tools/contact-sheet.js',
    from: '        low = Math.min(low, level);\n        high = Math.max(high, level);',
    to: '        if (i === from || i === to) { low = Math.min(low, level); high = Math.max(high, level); }',
    expect: "contact sheet: a strip's light flag judges each run of one shot by its lowest and highest level and largest move, broken at a shot's first cell and a failed cell",
  },
  {
    why: 'a run\'s move is the largest step between two neighbouring cells, so a slow drift sampled densely reads as held',
    file: 'tools/contact-sheet.js',
    from: 'b < points.length; b++) move',
    to: 'b < Math.min(points.length, a + 2); b++) move',
    expect: "contact sheet: a strip's light flag judges a run's move by the largest distance between two of its lights, so a slow drift sampled densely and a swing about its first light are not held",
  },
  {
    why: 'a run\'s move is measured from its first light only, so a lamp swinging about where it started reads half its swing',
    file: 'tools/contact-sheet.js',
    from: 'for (let a = 0; a < points.length; a++)',
    to: 'for (let a = 0; a < Math.min(1, points.length); a++)',
    expect: "contact sheet: a strip's light flag judges a run's move by the largest distance between two of its lights, so a slow drift sampled densely and a swing about its first light are not held",
  },
  {
    why: 'a held light flags the strip report, though steady light is a shot\'s normal state',
    file: 'tools/contact-sheet.js',
    from: "report.className = flags.empty.length || flags.holds.length ? 'note flag' : 'note';",
    to: "report.className = flags.empty.length || flags.holds.length || heldLights.length ? 'note flag' : 'note';",
    expect: 'contact sheet: on fixtures/light-film.cjs a --shots strip reports the light held only in its drift shot, counting a null light as 0 and catching a small lamp beside a brighter static area by its region',
  },
  {
    why: 'a cell that opens a shot is not captioned as a shot start, so its missing change reads as a fault',
    file: 'tools/contact-sheet.js',
    from: "? cell.shot + ', shot start · ' : '';",
    to: "? '' : '';",
    expect: 'contact sheet: a --frames or --at cell that opens a shot is captioned as a shot start',
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
    from: '    if (ids.has(real)) return ids.get(real);',
    to: '',
    expect: 'external pieces loaded as a list define a shared helper once and name what each piece reaches',
  },
  {
    why: 'two pieces of a list with the same name load, and the registry keeps only the second',
    file: 'tools/piece-input.js',
    from: '    if (named && named.id !== id) throw',
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
    from: "/^node tools\\/(?!run-tests\\.js)/.test(SCRIPTS[env.npm_lifecycle_event])",
    to: "/^node tools\\/(?!run-tests\\.js|styles)/.test(SCRIPTS[env.npm_lifecycle_event])",
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
    from: 'trusted: trusted[m.name]?.sha256 === hash,',
    to: 'trusted: Boolean(trusted[m.name]),',
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
    why: 'check passes a pack whose module exports mark functions its style.json does not list',
    file: 'tools/styles.js',
    from: '  if (names.join() !== m.marks.join()) {',
    to: '  if (false) {',
    expect: 'check loads a pack confined to its own files and refuses marks style.json does not list or a proof that fails',
  },
  {
    why: "check loads a pack's module unconfined, so it may require files outside the pack",
    file: 'tools/styles.js',
    from: '      if (!target || !files.includes(target)) throw',
    to: '      if (!target) throw',
    expect: 'check loads a pack confined to its own files and refuses marks style.json does not list or a proof that fails',
  },
  {
    why: 'a mark that draws differently each time passes its proof',
    file: 'tools/styles.js',
    from: '    if (differs >= 0) {',
    to: '    if (false) {',
    expect: 'a mark proof runs each function twice and refuses a drawing that differs, paints nothing or leaves its box',
  },
  {
    why: 'a mark that paints outside its proof\'s box passes',
    file: 'tools/styles.js',
    from: "    if (outside) throw new Error('the proof of '",
    to: "    if (false) throw new Error('the proof of '",
    expect: 'a mark proof runs each function twice and refuses a drawing that differs, paints nothing or leaves its box',
  },
  {
    why: 'a proof that paints nothing passes as a proof of a mark',
    file: 'tools/styles.js',
    from: "    if (!paints) throw new Error('the proof of '",
    to: "    if (false) throw new Error('the proof of '",
    expect: 'a mark proof runs each function twice and refuses a drawing that differs, paints nothing or leaves its box',
  },
  {
    why: 'an empty path or a rectangle of no size counts as a paint, so a mark that paints nothing passes',
    file: 'tools/styles.js',
    from: '    if (reached.some(([x, y]) => x !== reached[0][0] || y !== reached[0][1])) paints++;',
    to: '    paints++;',
    expect: 'a mark proof runs each function twice and refuses a drawing that differs, paints nothing or leaves its box',
  },
  {
    why: 'a proof that never calls its mark function passes, so the function is never proved',
    file: 'tools/styles.js',
    from: "      if (!called.has(name)) throw new Error('the proof of '",
    to: "      if (false) throw new Error('the proof of '",
    expect: 'a mark proof runs each function twice and refuses a drawing that differs, paints nothing or leaves its box',
  },
  {
    why: 'both runs of a mark proof share one load of the pack, so a value taken when the module loads passes as deterministic',
    file: 'tools/styles.js',
    from: '    const runs = [fresh(), later, later].map(',
    to: '    const runs = [later, later, later].map(',
    expect: 'check proves each run from a fresh load of the pack, and counts a call the proof makes through its own require of the module',
  },
  {
    why: 'a mark proof draws only once on each load, so a mark that keeps state between calls passes as deterministic',
    file: 'tools/styles.js',
    from: '    const runs = [fresh(), later, later].map(',
    to: '    const runs = [fresh(), later, fresh()].map(',
    expect: 'check draws each proof again on the same load, so a mark that keeps state between calls is refused',
  },
  {
    why: 'a proof surface logs an object argument by its size alone, so a matrix with different values each run passes as deterministic',
    file: 'tools/styles.js',
    from: '      return Object.fromEntries([...keys].map((key) => [key, shown(value[key])]));',
    to: "      return 'object ' + value.width + 'x' + value.height;",
    expect: 'a mark proof compares every value of an object it is given, refuses an image it cannot compare and checks the box on every run',
  },
  {
    why: 'a proof surface takes drawImage, so a mark that a real canvas refuses, or whose pixels cannot be compared, is proved',
    file: 'tools/styles.js',
    from: "    drawImage() {\n      throw new Error(",
    to: "    drawImage() {\n      if (false) throw new Error(",
    expect: 'a mark proof compares every value of an object it is given, refuses an image it cannot compare and checks the box on every run',
  },
  {
    why: 'a proof surface checks no shadow offset, so a visible shadow cast far outside the box is proved',
    file: 'tools/styles.js',
    from: '    if (shadow && (sx || sy) && !CLEAR',
    to: '    if (false && (sx || sy) && !CLEAR',
    expect: 'a mark proof compares every value of an object it is given, refuses an image it cannot compare and checks the box on every run',
  },
  {
    why: 'a proof surface leaves clearRect unchecked, so a mark that erases the whole canvas is proved',
    file: 'tools/styles.js',
    from: '    clearRect(x, y, w, h) { check(corners(x, y, w, h)); },',
    to: '    clearRect() {},',
    expect: 'a mark proof compares every value of an object it is given, refuses an image it cannot compare and checks the box on every run',
  },
  {
    why: 'a proof surface logs a Map or Set as {}, so a different value inside one passes as deterministic',
    file: 'tools/styles.js',
    from: '      if (value instanceof Map || value instanceof Set) return [value.constructor.name, ...[...value].map(shown)];\n',
    to: '',
    expect: 'a mark proof compares every value of an object it is given, refuses an image it cannot compare and checks the box on every run',
  },
  {
    why: 'a mark proof checks the box on its first run only, so a later run that paints outside it passes',
    file: 'tools/styles.js',
    from: '    for (const run of runs) {\n      const { paints, outside } = run.result();',
    to: '    for (const run of runs.slice(0, 1)) {\n      const { paints, outside } = run.result();',
    expect: 'a mark proof compares every value of an object it is given, refuses an image it cannot compare and checks the box on every run',
  },
  {
    why: "a proof's own require of the module returns unwatched functions, so a proof that calls its mark that way is refused as never calling it",
    file: 'tools/styles.js',
    from: '    cache.get(m.module).exports = marks;\n',
    to: '',
    expect: 'check proves each run from a fresh load of the pack, and counts a call the proof makes through its own require of the module',
  },
  {
    why: 'a style name in another case names no style',
    file: 'tools/styles.js',
    from: '  const wanted = String(name).toLowerCase();',
    to: '  const wanted = String(name);',
    expect: 'an installed pack with a built-in name is refused and the built-in style is used',
  },
  {
    why: 'npm run page prints a stack trace around a refused style instead of its reason',
    file: 'tools/build-page.js',
    from: '  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }',
    to: '  main();',
    expect: '--style draws nothing: page and seeds refuse it by exit code with the style\'s guide and module, and write nothing',
  },
  {
    why: 'npm run seeds throws a refused style past its catch, printing a stack trace instead of its reason',
    file: 'tools/contact-sheet.js',
    from: 'Promise.resolve().then(main).catch(',
    to: 'Promise.resolve(main()).catch(',
    expect: '--style draws nothing: page and seeds refuse it by exit code with the style\'s guide and module, and write nothing',
  },
  {
    why: 'npm run seeds -- --style=impasto is read as an unknown option instead of refused as a style',
    file: 'tools/contact-sheet.js',
    from: "    if (arg !== '--style' && !arg.startsWith('--style=')) continue;",
    to: "    if (arg !== '--style') continue;",
    expect: 'contact sheet: every mode refuses --style and --style=<name> with the style\'s guide and module paths',
  },
  {
    why: 'pack installs and trusts a pack whose marks are not proved',
    file: 'tools/styles.js',
    from: "    provePack(stage, m, 'pack: ' + name + ': nothing was installed, since ');\n",
    to: '',
    expect: 'pack removes its own output when a mark is not proved, and keeps the pack it would replace',
  },
  {
    why: 'pack leaves its build folder in ARTIFEX_HOME when a mark is not proved',
    file: 'tools/styles.js',
    from: '  } finally {\n    fs.rmSync(stage, { recursive: true, force: true });\n  }',
    to: '  } finally {\n    void stage;\n  }',
    expect: 'pack removes its own output when a mark is not proved, and keeps the pack it would replace',
  },
  {
    why: 'pack removes the pack it replaces before its marks are proved, so a failed replacement loses it',
    file: 'tools/styles.js',
    from: "  const sources = packSources([[module, 'marks.cjs'], [proof, 'proof.cjs']]);\n",
    to: "  const sources = packSources([[module, 'marks.cjs'], [proof, 'proof.cjs']]);\n  if (existing) fs.rmSync(dest, { recursive: true });\n",
    expect: 'pack removes its own output when a mark is not proved, and keeps the pack it would replace',
  },
  {
    why: 'pack --replace removes the old pack instead of moving it aside, so a failed install loses it',
    file: 'tools/styles.js',
    from: '    if (old) fs.renameSync(dest, old);\n',
    to: '    if (old) fs.rmSync(dest, { recursive: true });\n',
    expect: 'pack --replace restores the old pack and its trust when installing the new one fails',
  },
  {
    why: 'pack --replace leaves the old pack aside when the install fails',
    file: 'tools/styles.js',
    from: '        if (old) fs.renameSync(old, dest);\n',
    to: '        void old;\n',
    expect: 'pack --replace restores the old pack and its trust when installing the new one fails',
  },
  {
    why: 'pack --replace keeps the new pack\'s trust when the install fails after trusting it',
    file: 'tools/styles.js',
    from: '        if (JSON.stringify(readTrust(env).packs[name]) !== JSON.stringify(trusted)) setTrust(name, trusted, env);\n',
    to: '        void trusted;\n',
    expect: 'pack --replace restores the old pack and its trust when installing the new one fails',
  },
  {
    why: 'pack --replace leaves the old pack aside in ARTIFEX_HOME after installing the new one',
    file: 'tools/styles.js',
    from: '    try { if (old) fs.rmSync(old, { recursive: true, force: true }); }',
    to: '    try { if (false) fs.rmSync(old, { recursive: true, force: true }); }',
    expect: 'pack --replace restores the old pack and its trust when installing the new one fails',
  },
  {
    why: 'pack takes the module of mark functions as its own proof',
    file: 'tools/styles.js',
    from: '  if (module === proof) throw',
    to: '  if (false) throw',
    expect: 'pack refuses by name and writes nothing',
  },
  {
    why: 'pack takes a name the style.json rules refuse',
    file: 'tools/styles.js',
    from: '  if (!NAME.test(name) || name.length > 40) throw',
    to: '  if (name.length > 40) throw',
    expect: 'pack refuses by name and writes nothing',
  },
  {
    why: 'pack makes a pack under a built-in style\'s name, which is never used',
    file: 'tools/styles.js',
    from: "  if (builtins().some((style) => style.name === name)) throw new Error('pack: \"'",
    to: "  if (false) throw new Error('pack: \"'",
    expect: 'pack refuses by name and writes nothing',
  },
  {
    why: 'pack replaces an installed pack without --replace',
    file: 'tools/styles.js',
    from: '  if (existing && !options.replace) throw',
    to: '  if (false) throw',
    expect: 'pack refuses by name and writes nothing',
  },
  {
    why: 'pack --replace removes a linked install folder',
    file: 'tools/styles.js',
    from: '  if (existing && existing.isSymbolicLink()) throw',
    to: '  if (false) throw',
    expect: 'pack refuses by name and writes nothing',
  },
  {
    why: 'pack takes a guide without the built-in guides\' headings',
    file: 'tools/styles.js',
    from: "  if (problem) throw new Error('pack: '",
    to: "  if (false) throw new Error('pack: '",
    expect: 'pack refuses by name and writes nothing',
  },
  {
    why: 'a guide passes with its headings out of order',
    file: 'tools/styles.js',
    from: '(heading, i) => i >= at && heading.startsWith(',
    to: '(heading, i) => i >= 0 && heading.startsWith(',
    expect: 'a pack guide needs a title and the built-in guides\' headings in order',
  },
  {
    why: 'pack takes a module that exports a piece as a style\'s mark functions',
    file: 'tools/styles.js',
    from: "  if (piece.length) throw new Error(prefix + file + ' exports '",
    to: "  if (false) throw new Error(prefix + file + ' exports '",
    expect: 'pack refuses by name and writes nothing',
  },
  {
    why: 'style.json lists one mark function twice',
    file: 'tools/styles.js',
    from: '  if (new Set(m.marks).size !== m.marks.length) bad(',
    to: '  if (false) bad(',
    expect: 'style.json validation refuses each broken rule by name',
  },
  {
    why: 'pack copies a library example into the pack instead of refusing it, so the pack carries library code as its own',
    file: 'tools/styles.js',
    from: '        else if (LIBRARY_EXAMPLE.test(library)) {',
    to: '        else if (false) {',
    expect: 'pack copies a module, its proof and the files they reach into marks.cjs, proof.cjs and lib/, rewriting their requires',
  },
  {
    why: 'a style pack lists a file named after a Windows device with an extension, such as lib/aux.js, which Git for Windows cannot index',
    file: 'tools/styles.js',
    from: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    to: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *$|((?:com|lpt)[¹²³]) *$)/i;',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'a style pack lists a file named after a Windows device with spaces before its extension, such as "con .json"',
    file: 'tools/styles.js',
    from: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    to: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9])(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'a style pack lists a Windows device name in capitals, such as lib/AUX.js, which Windows reads as the same device',
    file: 'tools/styles.js',
    from: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    to: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/;',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'a device name at the end of an ordinary name, such as lib/x.con or the pack x-con, is refused though Windows reads it as a file',
    file: 'tools/styles.js',
    from: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    to: 'const DEVICE = /(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'a style pack lists CONIN$ or CONOUT$, the console devices, which Git for Windows cannot index',
    file: 'tools/styles.js',
    from: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    to: 'const DEVICE = /^(?:(con|prn|aux|nul|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'a style pack lists lib/lpt0.js or is named lpt0, which Git for Windows cannot index',
    file: 'tools/styles.js',
    from: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    to: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[1-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'a style pack lists a file named COM or LPT with a superscript digit, such as com¹, which Windows opens as a device',
    file: 'tools/styles.js',
    from: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    to: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$))/i;',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'a superscript COM or LPT before an extension, such as lib/com¹.js, is refused though Windows and Git take it as a file',
    file: 'tools/styles.js',
    from: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *$)/i;',
    to: 'const DEVICE = /^(?:(con|prn|aux|nul|conin\\$|conout\\$|com[1-9]|lpt[0-9]) *(?:\\.|$)|((?:com|lpt)[¹²³]) *(?:\\.|$))/i;',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'pack stages a helper named after a Windows device, such as ./aux.min.js, before refusing lib/aux.min.js, a file the author never named',
    file: 'tools/styles.js',
    from: '  if (why) throw new Error(\'pack: \' + file + \' would be packed as \'',
    to: '  if (false) throw new Error(\'pack: \' + file + \' would be packed as \'',
    expect: 'pack refuses a helper whose lib/ name style.json would refuse before staging anything, naming its source file',
  },
  {
    why: 'pack refuses only a device-named helper, staging one whose lib/ name holds ":" or ends in a dot or a space, which style.json refuses only after staging',
    file: 'tools/styles.js',
    from: '  const why = pathProblem(name);\n',
    to: '  const why = deviceProblem(path.basename(name));\n',
    expect: 'pack refuses a helper whose lib/ name style.json would refuse before staging anything, naming its source file',
  },
  {
    why: 'a style pack lists a file in a folder named after a Windows device, or named after one itself',
    file: 'tools/styles.js',
    from: "  if (device) return 'has a segment that '",
    to: "  if (false) return 'has a segment that '",
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'style.json names a pack after a Windows device, so its folder cannot be kept in Git on Windows',
    file: 'tools/styles.js',
    from: '  if (deviceProblem(m.name)) bad(',
    to: '  if (false) bad(',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'pack builds a pack named after a Windows device before refusing it by the style.json rule',
    file: 'tools/styles.js',
    from: '  if (deviceProblem(name)) throw',
    to: '  if (false) throw',
    expect: 'Windows device names are refused as a pack name and in every style.json path segment',
  },
  {
    why: 'npm run styles -- -h is refused as an unknown option instead of printing the usage',
    file: 'tools/styles.js',
    from: " || args.includes('-h')) return log(",
    to: ') return log(',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run styles -- pack --help prints the list usage, not the usage of pack',
    file: 'tools/styles.js',
    from: "return log(args[0] === 'pack' ? PACK_USAGE : USAGE);",
    to: 'return log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run styles refuses an unknown option with the usage line alone',
    file: 'tools/styles.js',
    from: "  if (option) throw refuse('unknown option ' + option);",
    to: '  if (option) throw new Error(USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'npm run styles refuses an unknown command with the usage line alone',
    file: 'tools/styles.js',
    from: "throw refuse('unknown command \"' + command + '\"');",
    to: 'throw new Error(USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'npm run styles -- list <name> is refused with the usage line alone',
    file: 'tools/styles.js',
    from: "throw refuse('list takes no style name, got \"' + name + '\"');",
    to: 'throw new Error(USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'check or trust with --json is refused with the usage line alone',
    file: 'tools/styles.js',
    from: "  if (json) throw refuse('--json belongs to list, not ' + command);",
    to: '  if (json) throw new Error(USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'check or trust without a style name is refused with the usage line alone',
    file: 'tools/styles.js',
    from: "  if (!name) throw refuse(command + ' needs a style name; npm run styles lists them');",
    to: '  if (!name) throw new Error(USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'check or trust with two style names is refused with the usage line alone',
    file: 'tools/styles.js',
    from: "throw refuse(command + ' takes one style name, got \"' + rest.slice(1).join('\" \"') + '\"');",
    to: 'throw new Error(USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'pack refuses an option missing its value with the usage line alone',
    file: 'tools/styles.js',
    from: "      if (i + 1 === args.length) throw refuse(args[i] + ' needs a value');",
    to: '      if (i + 1 === args.length) throw new Error(PACK_USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'pack refuses an unknown option with the usage line alone',
    file: 'tools/styles.js',
    from: "    else if (args[i].startsWith('-')) throw refuse('unknown option ' + args[i]);",
    to: "    else if (args[i].startsWith('-')) throw new Error(PACK_USAGE);",
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'pack refuses a second module of mark functions with the usage line alone',
    file: 'tools/styles.js',
    from: "throw refuse('one module of mark functions per pack, got \"' + options.marks + '\" and \"' + args[i] + '\"');",
    to: 'throw new Error(PACK_USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'pack refuses a missing --proof, --guide or --summary with the usage line alone',
    file: 'tools/styles.js',
    from: "  if (missing.length) throw refuse('missing ' + missing.map((key) => (key === 'marks' ? '<marks.js>' : '--' + key)).join(', '));",
    to: '  if (missing.length) throw new Error(PACK_USAGE);',
    expect: 'styles: a refused argument or command is named, then the usage line',
  },
  {
    why: 'the run root takes a long name, so a nested run passes the Windows path limit',
    file: 'tests/negative.js',
    from: "const RUN_PREFIX = 'artifex-" + "neg-';",
    to: "const RUN_PREFIX = 'artifex-negative-mutation-run-';",
    expect: 'every path a mutation run creates stays under the Windows limit with a 120-character TEMP',
  },
  // Split, as above, so each matches the runner's code once and not this list.
  {
    why: 'npm run negative -- --help is refused as an unknown option instead of printing the usage',
    file: 'tests/negative.js',
    from: "  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); " + 'return 0; }\n',
    to: '',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run negative refuses an unknown option with the usage line alone',
    file: 'tests/negative.js',
    from: "    if (!kind) throw refuse(" + "'unknown option ' + args[i]);",
    to: '    if (!kind) throw new Error(USAGE);',
    expect: 'negative: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run negative refuses an option missing its value with the usage line alone',
    file: 'tests/negative.js',
    from: "    if (!args[i + 1] || args[i + 1].startsWith('--')) throw refuse(" + "args[i] + ' needs a value');",
    to: "    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(USAGE);",
    expect: 'negative: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run negative takes a second --shard and runs only the first',
    file: 'tests/negative.js',
    from: "  if (shards.length > 1) throw refuse(" + "'give --shard only once');\n",
    to: '',
    expect: 'negative: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run negative refuses a shard outside 1..n with the usage line alone',
    file: 'tests/negative.js',
    from: "throw refuse('--shard needs k/n, " + "whole numbers with 1 <= k <= n, got ' + shards[0]);",
    to: 'throw new Error(USAGE);',
    expect: 'negative: a refused argument is named, then the usage line',
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
    from: "      if (options.force) throw refuse('give --force only once');",
    to: '',
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
    why: 'a forced WebM run names every refusal as drawing late, so an encoder stall reads as a slow piece',
    file: 'tools/check-browser.js',
    from: "const late = /the recorder took up to \\d+ ms to accept a frame/.test(error.message) ? 'recorder' : 'drawing';",
    to: "const late = 'drawing';",
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
    from: 'LUFS_WITHIN = 0.1,',
    to: 'LUFS_WITHIN = 0.5,',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check accepts a soundtrack louder than -14 LUFS that peaks at its ceiling, so a gain past the target passes',
    file: 'tools/check-browser.js',
    from: '(heard.dbtp >= ceiling - within && heard.lufs < target)',
    to: '(heard.dbtp >= ceiling - within)',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds a soundtrack stopped short to another ceiling than the export limits it under',
    file: 'tools/check-browser.js',
    from: '  const ceiling = loudness.ceiling[codec], within',
    to: '  const ceiling = -1.5, within',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds Opus within 0.1 dB under its ceiling, under the 0.10 dB Opus lowered a peak in installed Edge',
    file: 'tools/check-browser.js',
    from: 'PEAK_WITHIN = { mp4a: 0.1, Opus: 0.15 }',
    to: 'PEAK_WITHIN = { mp4a: 0.1, Opus: 0.1 }',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds AAC only within 0.15 dB under its ceiling, wider than the 0.03 dB AAC lowers a peak',
    file: 'tools/check-browser.js',
    from: 'PEAK_WITHIN = { mp4a: 0.1, Opus: 0.15 }',
    to: 'PEAK_WITHIN = { mp4a: 0.15, Opus: 0.15 }',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check judges the peak against a NaN bar when the loudness rise is not a finite number',
    file: 'tools/check-browser.js',
    from: '  if (!Number.isFinite(loudness.rise)) return',
    to: '  if (false) return',
    expect: 'the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js',
  },
  {
    why: 'the browser check lets an array or a class instance through as the ceiling object',
    file: 'tools/check-browser.js',
    from: '  if (proto !== Object.prototype && proto !== null) return',
    to: '  if (loudness.ceiling === null || typeof loudness.ceiling !== \'object\') return',
    expect: 'the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js',
  },
  {
    why: 'the browser check judges the peak against a NaN bar when a codec has no finite ceiling',
    file: 'tools/check-browser.js',
    from: '  if (!Number.isFinite(ceiling)) return',
    to: '  if (false) return',
    expect: 'the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js',
  },
  {
    why: 'the browser check judges the peak against a NaN bar when a codec has no finite peak margin',
    file: 'tools/check-browser.js',
    from: '  if (!Number.isFinite(within)) return',
    to: '  if (false) return',
    expect: 'the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js',
  },
  {
    why: 'the browser check judges a soundtrack against a NaN target when the loudness has none',
    file: 'tools/check-browser.js',
    from: '  if (!Number.isFinite(target)) return',
    to: '  if (false) return',
    expect: 'the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js',
  },
  {
    why: 'the browser check judges the reported shortfall against a NaN short when the loudness has none',
    file: 'tools/check-browser.js',
    from: '  if (!Number.isFinite(short)) return',
    to: '  if (false) return',
    expect: 'the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js',
  },
  {
    why: 'the browser check passes a soundtrack at -14 LUFS that decodes over the ceiling plus the rise',
    file: 'tools/check-browser.js',
    from: '  if (!(heard.dbtp < bar)) return',
    to: '  if (false) return',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds only Opus under the ceiling plus the rise, and a limited AAC soundtrack decoded over it passes',
    file: 'tools/check-browser.js',
    from: '  if (!(heard.dbtp < bar)) return',
    to: '  if (opus && !(heard.dbtp < bar)) return',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check holds a decoded peak under a fixed bar whatever ceiling LOUDNESS sets, so a higher ceiling refuses correct films',
    file: 'tools/check-browser.js',
    from: 'bar = ceiling + loudness.rise;',
    to: 'bar = -1;',
    expect: 'the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js',
  },
  {
    why: 'the browser check holds a decoded peak 1 dB over the ceiling whatever rise LOUDNESS sets, so another rise judges films by the old bar',
    file: 'tools/check-browser.js',
    from: 'bar = ceiling + loudness.rise;',
    to: 'bar = ceiling + 1;',
    expect: 'the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js',
  },
  {
    why: 'the browser check never compares the reported shortfall with the level the export encoded at',
    file: 'tools/check-browser.js',
    from: '  if (under !== short && (sound.short !== undefined) !== under > short) {',
    to: '  if (false) {',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check wants a shortfall from any soundtrack under -14 LUFS',
    file: 'tools/check-browser.js',
    from: '!== under > short) {',
    to: '!== under > 0) {',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
  },
  {
    why: 'the browser check refuses a report at exactly -17.00 LUFS whose shortfall, measured before rounding, is a hair past 3 LU',
    file: 'tools/check-browser.js',
    from: 'if (under !== short && (sound.short',
    to: 'if ((sound.short',
    expect: 'a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU',
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
    from: "if (film.conversion !== 'cpu') return",
    to: "if (false) return",
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
    why: 'replay reads a long film\'s per-block sound comparison in one reply, past what one CDP message may carry',
    file: 'tools/replay.js',
    from: "        sound = await evaluateInPieces(client, '(' + compareSound",
    to: "        sound = await evaluate(client, '(' + compareSound",
    expect: 'replay --dump writes a film\'s decoded soundtrack, its render and the per-block figures into a folder, and refuses by name what it cannot dump',
  },
  {
    why: 'a soundtrack cut short replays as a match',
    file: 'tools/replay.js',
    from: '  if (s.length[0] !== s.length[1]) {',
    to: '  if (false) {',
    expect: 'a film soundtrack matches only where it decodes to its recipe, levelled as the export levels it',
  },
  {
    why: 'a soundtrack block under its codec floor passes',
    file: 'tools/replay.js',
    from: '    const db = 10 * Math.log10(signal / error), over = db >= floor;',
    to: '    const db = 10 * Math.log10(signal / error), over = true;',
    expect: 'a soundtrack block is judged against its codec floor unless the difference is under the gate',
  },
  {
    why: 'a block with noise-like bands just over its floor is judged by the floor alone, so its figure slides through the floor with frame phase',
    file: 'tools/replay.js',
    from: '    if (over && !(noise > 0 && db < floor + SOUND_NEAR_DB[codec])) { worst',
    to: '    if (over) { worst',
    expect: 'a block within 1 dB over the AAC floor is judged by the noise rules too, so a crack\'s onset block reads the same either side of the floor',
  },
  {
    why: 'the soundtrack gate skips a block by its rendered level, so sound where the recipe is silent passes',
    file: 'tools/replay.js',
    from: '    if (error / samples < gate) continue;',
    to: '    if (signal / samples < gate) continue;',
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
    from: 'async function compareFilm(bytes, recipe, frames, first = 0) {\n  const api = window.__artifex;\n  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw',
    to: 'async function compareFilm(bytes, recipe, frames, first = 0) {\n  const api = window.__artifex;\n  if (false) throw',
    expect: 'every page function refuses a piece name that is not its own the same way',
  },
  {
    why: "the soundtrack replay indexes the page's examples with any name, inherited or missing",
    file: 'tools/replay.js',
    from: 'async function compareSound(bytes, recipe, block, codec, band, flatness, cut, voice, mask, span = null, sparse = null) {\n  const api = window.__artifex;\n  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw',
    to: 'async function compareSound(bytes, recipe, block, codec, band, flatness, cut, voice, mask, span = null, sparse = null) {\n  const api = window.__artifex;\n  if (false) throw',
    expect: 'every page function refuses a piece name that is not its own the same way',
  },
  {
    why: "a file that does not arrive leaves the page's file short and the replay carries on",
    file: 'tools/replay.js',
    from: '  if (held !== bytes.length) throw',
    to: '  if (false) throw',
    expect: 'a replayed file reaches the page whole in one fetch from the loopback server, not in DevTools messages',
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
    from: "    const exported = evaluateInPieces(client, '((frameMatch, soundMatch, loudnessMatch) => (' + inspectFilm.toString() + ')(' + JSON.stringify(name)",
    to: "    const exported = evaluate(client, '((frameMatch, soundMatch, loudnessMatch) => (' + inspectFilm.toString() + ')(' + JSON.stringify(name)",
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
    why: 'a whole part takes the piece clip, so a part of fractional height changes its pixels',
    file: 'tools/check-browser.js',
    from: '  if (count === Math.round(height)) return { x: 0, y: top, width, height, scale: 1 };',
    to: '',
    expect: 'a whole sheet part keeps its clip, and a piece is clipped from its first row',
  },
  {
    why: 'every piece is clipped from the top of its part, so later files repeat the first rows',
    file: 'tools/check-browser.js',
    from: '  return { x: 0, y: top + from, width, height: count, scale: 1 };',
    to: '  return { x: 0, y: top, width, height: count, scale: 1 };',
    expect: 'a whole sheet part keeps its clip, and a piece is clipped from its first row',
  },
  {
    why: 'sheetPieces ignores maxRows when a stretch fits in one reply, so a sheet file past the height cap is written whole',
    file: 'tools/check-browser.js',
    from: '    if (bytes <= SHOT_BYTES && to - from <= maxRows) return',
    to: '    if (bytes <= SHOT_BYTES) return',
    expect: 'a sheet part is cut so no piece is taller than maxRows, even when its bytes fit',
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
    why: 'npm run browser -- -h is refused as an unknown option instead of printing the usage',
    file: 'tools/check-browser.js',
    from: "    if (arg === '--help' || arg === '-h') options.help = true;",
    to: "    if (arg === '--help') options.help = true;",
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'the browser check refuses --edge without a path with the usage line alone',
    file: 'tools/check-browser.js',
    from: "throw refuse('--edge needs the path to msedge');",
    to: 'throw new Error(USAGE);',
    expect: 'browser: a refused argument is named, then the usage line',
  },
  {
    why: 'the browser check refuses a --timeout-ms that is not a whole number with the usage line alone',
    file: 'tools/check-browser.js',
    from: "throw refuse('--timeout-ms needs a whole number of milliseconds, got ' + (args[i + 1] ?? 'nothing'));",
    to: 'throw new Error(USAGE);',
    expect: 'browser: a refused argument is named, then the usage line',
  },
  {
    why: 'every tool that reads --timeout-ms through timeoutArg accepts a value under its floor, down to 0 ms',
    file: 'tools/check-browser.js',
    from: '  if (!/^\\d+$/.test(text) || ms < min || ms > max) {',
    to: '  if (!/^\\d+$/.test(text) || ms > max) {',
    expect: 'browser: a refused argument is named, then the usage line',
  },
  {
    why: 'every tool that reads --timeout-ms through timeoutArg accepts a value over its ceiling',
    file: 'tools/check-browser.js',
    from: '  if (!/^\\d+$/.test(text) || ms < min || ms > max) {',
    to: '  if (!/^\\d+$/.test(text) || ms < min) {',
    expect: 'browser CLI validates deadlines and never requires a browser for help',
  },
  {
    why: 'timeoutArg passes a --timeout-ms past setTimeout\'s limit, which Node shortens to 1 ms, when a tool gives a higher max',
    file: 'tools/check-browser.js',
    from: '  max = Math.min(max, 2147483647);',
    to: '',
    expect: 'timeoutArg: a max past setTimeout\'s limit is held to 2147483647',
  },
  {
    why: 'the browser check refuses an unknown --force condition with the usage line alone',
    file: 'tools/check-browser.js',
    from: "throw refuse('--force takes no-aac, no-webgl2, no-h264 or gpu-crash, got ' + (args[i + 1] ?? 'nothing'));",
    to: 'throw new Error(USAGE);',
    expect: 'browser: a refused argument is named, then the usage line',
  },
  {
    why: 'the browser check refuses an unknown option with the usage line alone',
    file: 'tools/check-browser.js',
    from: "    else throw refuse('unknown option ' + arg);",
    to: '    else throw new Error(USAGE);',
    expect: 'browser: a refused argument is named, then the usage line',
  },
  {
    why: 'replay closes a WebM frame only after a read that succeeds, so a read that throws leaves the VideoFrame open',
    file: 'tools/replay.js',
    from: '    if (!sought) { rows.push({ frame: i, seekTimeoutMs: 10000 }); break; }\n    await new Promise((resolve) => setTimeout(resolve, 60));\n'
      + '    const frame = new VideoFrame(video);\n    let got;\n    try { got = shrink(frame); } finally { frame.close(); }\n    rows.push({\n      frame: i, psnr: psnr(got, drawn(i)),\n      neighbours: [i - 1, i + 1].filter((j) => j >= 0 && j < heads.length).map((j) => ({ frame: j, psnr: psnr(got, drawn(j)) })),\n    });\n  }\n  URL.revokeObjectURL',
    to: '    if (!sought) { rows.push({ frame: i, seekTimeoutMs: 10000 }); break; }\n    await new Promise((resolve) => setTimeout(resolve, 60));\n'
      + '    const frame = new VideoFrame(video);\n    const got = shrink(frame);\n    frame.close();\n    rows.push({\n      frame: i, psnr: psnr(got, drawn(i)),\n      neighbours: [i - 1, i + 1].filter((j) => j >= 0 && j < heads.length).map((j) => ({ frame: j, psnr: psnr(got, drawn(j)) })),\n    });\n  }\n  URL.revokeObjectURL',
    expect: 'a WebM frame whose read throws still closes the VideoFrame it was read through',
  },
  {
    why: 'a block under its floor matches by its noise-like bands whatever the rest of it decodes to, so a moved tone passes',
    file: 'tools/replay.js',
    from: '    if (!(10 * Math.log10(signal / heard) >= floor)) return',
    to: '    if (false) return',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'rounding that takes the rest of a block under zero refuses a block whose whole difference is in its noise-like bands',
    file: 'tools/replay.js',
    from: 'const restError = Math.max(0, error - noiseError),',
    to: 'const restError = error - noiseError,',
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
    from: '      if (!onset && !(kept >= level)) return',
    to: '      if (false) return',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'noise-like band levels are held only to 12 dB, which a voice 3 dB louder keeps',
    file: 'tools/replay.js',
    from: 'const SOUND_NOISE_DB = { waveform: 3, envelope: 18, rest: 10 };',
    to: 'const SOUND_NOISE_DB = { waveform: 3, envelope: 12, rest: 10 };',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'the rest of a block is judged only against the whole block, so a tone moved under loud noise keeps the Opus floor',
    file: 'tools/replay.js',
    from: '    if (!(own >= rest) && restError / samples >= gate) return',
    to: '    if (false) return',
    expect: 'each noise-like band and the rest of a block keep their own waveform, so a quiet voice replaced or a tone moved under loud noise still differs',
  },
  {
    why: 'the rest is measured against the whole block, noise included, so a tone moved under loud noise follows it',
    file: 'tools/replay.js',
    from: 'const own = 10 * Math.log10(Math.max(0, signal - noise) / restError);',
    to: 'const own = 10 * Math.log10(signal / restError);',
    expect: 'each noise-like band and the rest of a block keep their own waveform, so a quiet voice replaced or a tone moved under loud noise still differs',
  },
  {
    why: 'the rest is held only to 5 dB of its own waveform, which a tone 3 dB quieter keeps',
    file: 'tools/replay.js',
    from: 'const SOUND_NOISE_DB = { waveform: 3, envelope: 18, rest: 10 };',
    to: 'const SOUND_NOISE_DB = { waveform: 3, envelope: 18, rest: 5 };',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'a rest silent in the render is judged by its own waveform even when its difference is under the gate',
    file: 'tools/replay.js',
    from: '!(own >= rest) && restError / samples >= gate)',
    to: '!(own >= rest))',
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'noise-like bands are judged only together, so a quiet noise voice replaced by another passes',
    file: 'tools/replay.js',
    from: '    if (!(alone >= waveform)) return',
    to: '    if (false) return',
    expect: 'each noise-like band and the rest of a block keep their own waveform, so a quiet voice replaced or a tone moved under loud noise still differs',
  },
  {
    why: 'the page names the band whose waveform the film follows best, so a replaced voice hides behind the others',
    file: 'tools/replay.js',
    from: 'want * worst[2] < worst[1] * diff)',
    to: 'want * worst[2] > worst[1] * diff)',
    expect: 'each noise-like band and the rest of a block keep their own waveform, so a quiet voice replaced or a tone moved under loud noise still differs',
  },
  {
    why: 'every noise-like band is judged alone however quiet, so a band the codec keeps loosely fails its own film',
    file: 'tools/replay.js',
    from: 'if (high || want < signal * 10 ** (voice.share / 10) || (onset && !isNear)) continue;',
    to: 'if (high || (onset && !isNear)) continue;',
    expect: 'a noise-like band a codec may not keep is judged only with the others: 41 dB under its block, or above 14 kHz',
  },
  {
    why: 'a near band is judged alone however quiet, so a quiet band AAC codes loosely refuses its own film',
    file: 'tools/replay.js',
    from: 'if (high || want < signal * 10 ** (voice.share / 10) || (onset && !isNear)) continue;',
    to: 'if (high || (!isNear && want < signal * 10 ** (voice.share / 10)) || (onset && !isNear)) continue;',
    expect: 'a near band under 25 dB of its block is judged only with the other noise-like bands, as a quiet noise-like band is',
  },
  {
    why: 'beside an onset a near band is judged only with the others, so a tone in it moved or dropped beside a contact passes',
    file: 'tools/replay.js',
    from: 'if (high || want < signal * 10 ** (voice.share / 10) || (onset && !isNear)) continue;',
    to: 'if (high || want < signal * 10 ** (voice.share / 10) || onset) continue;',
    expect: 'a near band beside an onset is still judged on its own, so a tone there moved, dropped or 6 dB quieter differs beside a click',
  },
  {
    why: 'a block beside an onset with no noise-like band under 14 kHz counts as levelled, and its verdict names a level it never judged',
    file: 'tools/replay.js',
    from: 'if (onset === 2) unlevelled++;',
    to: 'if (false) unlevelled++;',
    expect: 'a near band keeps its own level within 12 dB, and beside an onset the noise-like bands keep theirs together within 12 dB instead of 18',
  },
  {
    why: 'bands are judged alone down to 45 dB under their block, so a band the codec keeps loosely fails',
    file: 'tools/replay.js',
    from: 'const SOUND_VOICE = { share: -25, below: 14000 };',
    to: 'const SOUND_VOICE = { share: -45, below: 14000 };',
    expect: 'a noise-like band a codec may not keep is judged only with the others: 41 dB under its block, or above 14 kHz',
  },
  {
    why: 'bands above 14 kHz are judged alone, where Opus keeps waveform loosely',
    file: 'tools/replay.js',
    from: 'if (high || want < signal',
    to: 'if (want < signal',
    expect: 'a noise-like band a codec may not keep is judged only with the others: 41 dB under its block, or above 14 kHz',
  },
  {
    why: 'bands are judged alone up to 20 kHz, into the band Opus codes loosely',
    file: 'tools/replay.js',
    from: 'const SOUND_VOICE = { share: -25, below: 14000 };',
    to: 'const SOUND_VOICE = { share: -25, below: 20000 };',
    expect: 'a noise-like band a codec may not keep is judged only with the others: 41 dB under its block, or above 14 kHz',
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
    why: 'every band that is not noise-like leaves the floor whatever its difference, so a codec error as loud as the noise bed passes',
    file: 'tools/replay.js',
    from: 'if (diff <= ((hi - lo) * 2 * sorted[(hi - lo) >> 1] * 10 ** (mask / 10)) / (block * 0.375)) masked += diff;',
    to: 'masked += diff;',
    expect: 'tones a noise bed masks may keep their waveform only under that noise, and a different soundtrack still differs',
  },
  {
    why: 'an Opus block keeps its floor in the bands under the render\'s noise, so an Opus film of grains 50 times their bed is refused',
    file: 'tools/replay.js',
    from: 'heard = Math.max(0, restError - masked);',
    to: "heard = Math.max(0, restError - (codec === 'mp4a' ? masked : 0));",
    expect: 'a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels',
  },
  {
    why: 'Opus takes the AAC mask, which refuses an Opus film whose tonal band lies 4.5 dB under the render\'s noise',
    file: 'tools/replay.js',
    from: 'const SOUND_MASK_DB = { mp4a: -6, Opus: -3 };',
    to: 'const SOUND_MASK_DB = { mp4a: -6, Opus: -6 };',
    expect: 'an Opus block leaves out a tonal band only where its difference lies 3 dB or more under the render\'s own noise there',
  },
  {
    why: 'Opus leaves out a tonal band whose difference lies 1.5 dB under the render\'s noise',
    file: 'tools/replay.js',
    from: 'const SOUND_MASK_DB = { mp4a: -6, Opus: -3 };',
    to: 'const SOUND_MASK_DB = { mp4a: -6, Opus: 0 };',
    expect: 'an Opus block leaves out a tonal band only where its difference lies 3 dB or more under the render\'s own noise there',
  },
  {
    why: 'every band is noise-like, so a tone is judged as noise',
    file: 'tools/replay.js',
    from: 'if (!(flat[b][2] >= flatness) && !near(b)) {',
    to: 'if (!(flat[b][2] >= 0) && !near(b)) {',
    expect: 'a noise voice replays by what a perceptual codec keeps of it, and a different one still differs',
  },
  {
    why: 'no band near the flatness counts as noise-like, so a noise band that falls under it by chance refuses its own film',
    file: 'tools/replay.js',
    from: 'flat[b][2] >= sparse.near && [b - 1',
    to: 'false && [b - 1',
    expect: 'a band of noise just under the noise-like flatness, between noise-like bands, is judged as noise, and a tone there moved, dropped or 6 dB quieter still differs',
  },
  {
    why: 'a near band\'s own level is never judged, so a tone in it 6 dB quieter passes',
    file: 'tools/replay.js',
    from: 'if (!(held >= SOUND_SPARSE.envelope)) return',
    to: 'if (false) return',
    expect: 'a band of noise just under the noise-like flatness, between noise-like bands, is judged as noise, and a tone there moved, dropped or 6 dB quieter still differs',
  },
  {
    why: 'no block lies beside an onset, so AAC\'s short-window coding of sparse contacts refuses its own film',
    file: 'tools/replay.js',
    from: 'const onset = loudest > 0 && loudest >= ',
    to: 'const onset = false && loudest >= ',
    expect: 'beside an onset noise-like bands are judged together, and their levels under 14 kHz within 12 dB, as AAC coded the seams\' sparse noise contacts, and a changed contact still differs',
  },
  {
    why: 'every block lies beside an onset, so a quiet noise voice replaced under steady louder noise passes',
    file: 'tools/replay.js',
    from: 'const onset = loudest > 0 && loudest >= ',
    to: 'const onset = !!sparse || loudest >= ',
    expect: 'each noise-like band and the rest of a block keep their own waveform, so a quiet voice replaced or a tone moved under loud noise still differs',
  },
  {
    why: 'beside an onset the levels take in the bands above 14 kHz, so the codec\'s noise after a sound stops refuses its own film',
    file: 'tools/replay.js',
    from: 'if (!(onset && high)) {',
    to: 'if (true) {',
    expect: 'beside an onset noise-like bands are judged together, and their levels under 14 kHz within 12 dB, as AAC coded the seams\' sparse noise contacts, and a changed contact still differs',
  },
  {
    why: 'beside an onset the level error under 14 kHz is set against every noise-like band\'s energy, so bright noise above 14 kHz lets a contact 3 dB quieter pass',
    file: 'tools/replay.js',
    from: '    if (levelled > 0) envelope *= noise / levelled;\n',
    to: '',
    expect: 'beside an onset noise-like bands are judged together, and their levels under 14 kHz within 12 dB, as AAC coded the seams\' sparse noise contacts, and a changed contact still differs',
  },
  {
    why: 'beside an onset the levels keep 18 dB, so AAC\'s coarser levels there refuse their own film',
    file: 'tools/replay.js',
    from: 'if (onset === 1 && !(kept >= SOUND_SPARSE.envelope)) return',
    to: 'if (onset === 1 && !(kept >= level)) return',
    expect: 'a near band keeps its own level within 12 dB, and beside an onset the noise-like bands keep theirs together within 12 dB instead of 18',
  },
  {
    why: 'near bands and blocks beside an onset keep their levels within 9 dB, so a tone or a voice 3 dB quieter passes',
    file: 'tools/replay.js',
    from: 'const SOUND_SPARSE = { near: 0.2, onset: 6, envelope: 12 };',
    to: 'const SOUND_SPARSE = { near: 0.2, onset: 6, envelope: 9 };',
    expect: 'a near band keeps its own level within 12 dB, and beside an onset the noise-like bands keep theirs together within 12 dB instead of 18',
  },
  {
    why: 'an Opus film gets no sparse-noise allowance, so its film of ambience grains differs from its own recipe beside a grain\'s onset',
    file: 'tools/replay.js',
    from: 'JSON.stringify(span), JSON.stringify(SOUND_SPARSE)].join',
    to: "JSON.stringify(span), JSON.stringify(plan.codec === 'mp4a' ? SOUND_SPARSE : null)].join",
    expect: 'the sparse-noise allowance is passed to the page for an AAC film and an Opus film alike',
  },
  {
    why: 'no block holds a louder neighbour\'s coding noise, so the AAC film of a grain with no bed under it differs from its own recipe',
    file: 'tools/replay.js',
    from: '    if (10 * Math.log10(beside / error) >= SOUND_SPILL_DB.under[codec]',
    to: '    if (false && 10 * Math.log10(beside / error) >= SOUND_SPILL_DB.under[codec]',
    expect: 'a grain\'s coding noise in the quiet block after it replays as AAC, and a moved grain or louder noise there still differs',
  },
  {
    why: 'only an AAC film holds a louder neighbour\'s coding noise, so the Opus film of a grain with no bed under it differs from its own recipe',
    file: 'tools/replay.js',
    from: '    if (10 * Math.log10(beside / error) >= SOUND_SPILL_DB.under[codec]',
    to: "    if (codec === 'mp4a' && 10 * Math.log10(beside / error) >= SOUND_SPILL_DB.under[codec]",
    expect: 'an Opus film of ambience grains replays: its bands beside an onset judged by the sparse-noise rules, and a grain\'s noise in the quiet block beside it 25 dB under that block',
  },
  {
    why: 'an Opus film takes AAC\'s 30 dB for a neighbour\'s coding noise, so its film of grains differs from its own recipe at a block 28.2 dB under',
    file: 'tools/replay.js',
    from: 'SOUND_SPILL_DB.under[codec] && !(',
    to: 'SOUND_SPILL_DB.under.mp4a && !(',
    expect: 'an Opus film of ambience grains replays: its bands beside an onset judged by the sparse-noise rules, and a grain\'s noise in the quiet block beside it 25 dB under that block',
  },
  {
    why: 'an Opus film passes a neighbour\'s noise 20 dB under it, so louder noise in the quiet block after a grain passes',
    file: 'tools/replay.js',
    from: 'const SOUND_SPILL_DB = { under: { mp4a: 30, Opus: 25 }, louder: 12 };',
    to: 'const SOUND_SPILL_DB = { under: { mp4a: 30, Opus: 20 }, louder: 12 };',
    expect: 'an Opus film of ambience grains replays: its bands beside an onset judged by the sparse-noise rules, and a grain\'s noise in the quiet block beside it 25 dB under that block',
  },
  {
    why: 'an AAC film passes a neighbour\'s noise 25 dB under it, as Opus does, so louder noise after a grain passes as AAC',
    file: 'tools/replay.js',
    from: 'const SOUND_SPILL_DB = { under: { mp4a: 30, Opus: 25 }, louder: 12 };',
    to: 'const SOUND_SPILL_DB = { under: { mp4a: 25, Opus: 25 }, louder: 12 };',
    expect: 'in an AAC film, a quiet block beside a block 12 dB or more louder matches where its difference lies 30 dB under that block, as AAC spreads a grain\'s noise into it',
  },
  {
    why: 'a block beside one barely louder than itself passes 30 dB under it, so a block 6 dB under its floor passes beside a twin',
    file: 'tools/replay.js',
    from: ' && !(10 * Math.log10(beside / signal) < SOUND_SPILL_DB.louder)) { spilled++; continue; }',
    to: ') { spilled++; continue; }',
    expect: 'in an AAC film, a quiet block beside a block 12 dB or more louder matches where its difference lies 30 dB under that block, as AAC spreads a grain\'s noise into it',
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
    from: 'drift = (Math.sqrt(got) - Math.sqrt(want)) ** 2;',
    to: 'drift = (got - want) ** 2;',
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
    why: 'refit keeps its things at their default size in a box with more room than the default one, so its largest box piles up four times the things and the solve takes many times as long',
    file: 'examples/refit.js',
    from: '      const grain = s.params.grain * Math.min(fit, Math.max(1, Math.sqrt(room / AREA * Math.sqrt(tall))));',
    to: '      const grain = s.params.grain;',
    expect: 'refit: a roomier or taller box scales its things up by one continuous factor, its largest holding about half as many, its tallest narrow one fewer than at their size; a short roomy box keeps them at their size; its default box at its smallest grain holds many more; and each fills within the film and comes to rest',
  },
  {
    why: 'refit scales its things up with the root of a box\'s room alone, so a tall box holds as many things as the default one, each falling and settling through more frames, and the solve takes longer than it should',
    file: 'examples/refit.js',
    from: '      const grain = s.params.grain * Math.min(fit, Math.max(1, Math.sqrt(room / AREA * Math.sqrt(tall))));',
    to: '      const grain = s.params.grain * Math.min(fit, Math.max(1, Math.sqrt(room / AREA)));',
    expect: 'refit: a roomier or taller box scales its things up by one continuous factor, its largest holding about half as many, its tallest narrow one fewer than at their size; a short roomy box keeps them at their size; its default box at its smallest grain holds many more; and each fills within the film and comes to rest',
  },
  {
    why: 'refit keeps its things at their size in every box with no more room than the default one, so the factor jumps at the default room, a tall narrow box a hair roomier than the default scaling them by a third more than one a hair less roomy, and a tall narrow box with less room holds as many as their size allows, each falling and settling through more frames',
    file: 'examples/refit.js',
    from: '      const grain = s.params.grain * Math.min(fit, Math.max(1, Math.sqrt(room / AREA * Math.sqrt(tall))));',
    to: '      const grain = s.params.grain * (room > AREA ? Math.min(fit, Math.sqrt(room / AREA * Math.sqrt(tall))) : 1);',
    expect: 'refit: a roomier or taller box scales its things up by one continuous factor, its largest holding about half as many, its tallest narrow one fewer than at their size; a short roomy box keeps them at their size; its default box at its smallest grain holds many more; and each fills within the film and comes to rest',
  },
  {
    why: 'refit scales its things down in a short roomy box, whose factor comes to less than one, so it holds more things, smaller, than the default box does, and the factor is not one where the room is the default\'s',
    file: 'examples/refit.js',
    from: '      const grain = s.params.grain * Math.min(fit, Math.max(1, Math.sqrt(room / AREA * Math.sqrt(tall))));',
    to: '      const grain = s.params.grain * Math.min(fit, Math.sqrt(room / AREA * Math.sqrt(tall)));',
    expect: 'refit: a roomier or taller box scales its things up by one continuous factor, its largest holding about half as many, its tallest narrow one fewer than at their size; a short roomy box keeps them at their size; its default box at its smallest grain holds many more; and each fills within the film and comes to rest',
  },
  {
    why: 'refit scales its things for the frame alone, so a film whose timeline visits a box far smaller than its frame scales them past what that box can take, and the box ends empty',
    file: 'examples/refit.js',
    from: '      const grain = s.params.grain * Math.min(fit, Math.max(1, Math.sqrt(room / AREA * Math.sqrt(tall))));',
    to: '      const grain = s.params.grain * Math.max(1, Math.sqrt(room / AREA * Math.sqrt(tall)));',
    expect: 'refit: a film whose timeline visits a box far smaller than its frame scales its things only as far as that box still takes the smallest of them, takes nothing out of the air as the box closes, and ends with some held',
  },
  {
    why: 'refit lets the room a settling pile opens in a still box start the rain again, so a heaped pile keeps taking a thing every few frames to the end of the film, each costing a solve of the whole pile',
    file: 'examples/refit.js',
    from: '        if (moving) full = false;',
    to: '        full = false;',
    expect: 'refit: a full container in a still box takes nothing more as its pile packs closer, even at its strongest grip, where it heaps',
  },
  {
    why: 'refit waits at the first thing too big for the room there is instead of passing it over, so a short box never fills',
    file: 'examples/refit.js',
    from: '          if (area + Math.PI * th.r * th.r > cap || col < 0) continue;',
    to: '          if (area + Math.PI * th.r * th.r > cap || col < 0) { next--; break; }',
    expect: 'refit: its shortest, smallest, lowest and narrowest declared boxes each fill early in the film with the things that fit them, at every grain, the narrow tall ones at the strongest grip too',
  },
  {
    why: 'refit counts on a wide box\'s packing in a channel barely wider than its biggest things, so the narrowest tall box at the biggest grain and the strongest grip lands four things over the rim, which vanish',
    file: 'examples/refit.js',
    from: '        const packing = PACKING * (1 - 0.25 * Math.max(0, 2 * RMAX * grain / (Rw - L) - 1 / 3));',
    to: '        const packing = PACKING;',
    expect: 'refit: its shortest, smallest, lowest and narrowest declared boxes each fill early in the film with the things that fit them, at every grain, the narrow tall ones at the strongest grip too',
  },
  {
    why: 'refit counts a narrow channel\'s falling train by packing alone, never by its area, so a tall narrow box widened with its drops still in the air lands them over the rim',
    file: 'examples/refit.js',
    from: '        const exact = Math.min(1, 6 * (1 - packing / PACKING)) * clamp((0.5 - grip) / 0.25, 0, 1);',
    to: '        const exact = 0;',
    expect: 'refit: a channel barely wider than its biggest things counts its falling train by area, so a tall narrow box widened to the largest, its first fill declared full with every drop still in the air, lands within one small release of the rim',
  },
  {
    why: 'refit exempts a floor place\'s neighbour even when it stands over the place sinking at it, so a thing born there is run into while it grows',
    file: 'examples/refit.js',
    from: '              const beside = ya >= inFloor - 2 * r || live.vy[a] - sink < REST * HZ ? [a] : [];',
    to: '              const beside = [a];',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, tall narrow to largest',
  },
  {
    why: 'refit goes on releasing things that cannot land before the box narrows, so the walls close under a rain and things fall in only to vanish in mid-air',
    file: 'examples/refit.js',
    from: '            if (f + 1.5 * fall * (1 + DRAG * fall / (6 * HZ)) + LAND >= narrows[f]) break;',
    to: '            if (false) break;',
    expect: 'refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim',
  },
  {
    why: 'refit lets the things waiting to fall in queue over the frame without limit, so a film scaled for a roomy box that opens in a narrow one enters the frame from a height that crosses it in a few frames',
    file: 'examples/refit.js',
    from: '          if (y < -QUEUE * (floor - rim)) break;',
    to: '          if (false) break;',
    expect: 'refit: the things waiting to fall in stand no higher over the frame than the container is tall and a half, so nothing enters the frame faster than a fall from there',
  },
  {
    why: 'refit steps every thing outside the sim as a free fall, never handing it to the sim within reach of the pile, so nothing lands',
    file: 'examples/refit.js',
    from: '              if (live.y[k] + th.r + (live.vy[k] + GRAVITY / HZ) / HZ + 2 * small < top) { falling.push(k); continue; }',
    to: '              if (true) { falling.push(k); continue; }',
    expect: 'refit: a narrower box holds fewer of the same things, each inside it and clear of the rest',
  },
  {
    why: 'refit scales its things for a film\'s frame, which is never shown, so a timeline between two boxes with no more room than the default scales them up and holds a fraction of what those boxes hold',
    file: 'examples/refit.js',
    from: '      const most = boxes.reduce((m, b) => (roomOf(b) > roomOf(m) ? b : m));',
    to: '      const most = s.box;',
    expect: 'refit: a film scales its things for the roomiest box its timeline visits, never for its frame, so one between a short box and a tall one scales them for the tall one and holds about as many as those boxes do',
  },
  {
    why: 'refit solves a pile at rest to the end of the film, creeping a hair a frame, so every still box costs a solve of the whole pile for every frame after its last thing lands',
    file: 'examples/refit.js',
    from: '          resting = calm;',
    to: '          resting = false;',
    expect: 'refit: a still box holds its pile only once nothing in it moves a unit a frame, which comes within two seconds and a half of the last thing landing even for a heap at the strongest grip',
  },
  {
    why: 'refit holds a pile as soon as every thing has landed, so a heap at the strongest grip freezes with things still slipping units a frame',
    file: 'examples/refit.js',
    from: 'const REST = 1;',
    to: 'const REST = 20;',
    expect: 'refit: a still box holds its pile only once nothing in it moves a unit a frame, which comes within two seconds and a half of the last thing landing even for a heap at the strongest grip',
  },
  {
    why: 'refit asks a release for its room to the last bit, so a film whose scale the smallest box bounds, its smallest things exactly as tall as that room less the clearance, takes nothing for that box when rounding falls the wrong way',
    file: 'examples/refit.js',
    from: '            if (room + 1e-9 >= 2 * r + CLEAR && room - queue > score) { best = c; score = room - queue; }',
    to: '            if (room >= 2 * r + CLEAR && room - queue > score) { best = c; score = room - queue; }',
    expect: 'refit: a film that starts in a box the fit bound scales its smallest things exactly to fills that box, whatever rounding the bound leaves',
  },
  {
    why: 'refit goes on releasing things while its box narrows, so they fall in only for the closing walls to squeeze them out again',
    file: 'examples/refit.js',
    from: '        const rate = shrinking ? 0 : moving ? (filled ? Infinity : 1) : Math.max(RATE, Math.ceil(RATE * (Rw - L) * (floor - rim) / (grain * grain * AREA)));',
    to: '        const rate = moving ? (filled ? Infinity : 1) : Math.max(RATE, Math.ceil(RATE * (Rw - L) * (floor - rim) / (grain * grain * AREA)));',
    expect: 'refit: while its box moves it releases at most one thing a frame, none while the box narrows, and loses none of those',
  },
  {
    why: 'refit rains several things a frame onto a pile whose box is moving, which flickers enough for the film to warn of flashing',
    file: 'examples/refit.js',
    from: '        const rate = shrinking ? 0 : moving ? (filled ? Infinity : 1) : Math.max(RATE, Math.ceil(RATE * (Rw - L) * (floor - rim) / (grain * grain * AREA)));',
    to: '        const rate = shrinking ? 0 : moving && filled ? Infinity : Math.max(RATE, Math.ceil(RATE * (Rw - L) * (floor - rim) / (grain * grain * AREA)));',
    expect: 'refit: while its box moves it releases at most one thing a frame, none while the box narrows, and loses none of those',
  },
  {
    why: 'refit draws a thing shrinking away from its contact without keeping its drawn disc inside the walls while they go on closing, so it stands over the hatched surround outside its box',
    file: 'examples/refit.js',
    from: '      at.x = clamp(at.x, box.x + c.x0 + at.r, box.x + c.x1 - at.r);',
    to: '      at.x += 0;',
    expect: 'refit: a box that closes fast under a tall box stops the rain in time to land before the walls move, so nothing is jammed into a column above the rim or taken in one flash',
  },
  {
    why: 'refit draws a thing shrinking away from its contact without keeping its drawn disc below the box\'s top while the box goes on shrinking in height, so it stands above the top, over the hatched surround',
    file: 'examples/refit.js',
    from: '      if (was[3 * k + 1] - th.r >= b.y) at.y = clamp(at.y, box.y + at.r, floor - at.r);',
    to: '      if (false) at.y = clamp(at.y, box.y + at.r, floor - at.r);',
    expect: 'refit: a box that closes fast under a tall box stops the rain in time to land before the walls move, so nothing is jammed into a column above the rim or taken in one flash',
  },
  {
    why: 'refit takes a landed thing that a squeeze flings up over the rim while it is still in the air, clear of every thing, wall and floor, instead of letting it fly on until it touches something again',
    file: 'examples/refit.js',
    from: '          const goes = new Map(on.filter((k) => over.has(k) && grounded.has(k)).map((k) => [k, under(k)]));',
    to: '          const goes = new Map(on.filter((k) => over.has(k)).map((k) => [k, under(k)]));',
    expect: 'refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim',
  },
  {
    why: 'refit counts a wall as touched along the sim\'s whole wall line, which reaches up over the box, so a landed thing a squeeze flings up over the surround is taken in mid-air as soon as it brushes that line, high above the drawn wall',
    file: 'examples/refit.js',
    from: '              const up = Math.max(0, rim - LIP - live.y[k]);',
    to: '              const up = 0;',
    expect: 'refit: a film whose timeline visits a box far smaller than its frame scales its things only as far as that box still takes the smallest of them, takes nothing out of the air as the box closes, and ends with some held',
  },
  {
    why: 'refit counts any other thing a flung thing touches as contact, so two things a squeeze flings up together, touching only each other, are both taken in mid-air, hundreds of units over the box',
    file: 'examples/refit.js',
    from: '            const stack = [...grounded];',
    to: '            for (const k of on) for (const j of on) if (j !== k && Math.hypot(live.x[j] - live.x[k], live.y[j] - live.y[k]) - things[k].r - things[j].r < TOUCH) grounded.add(k);\n            const stack = [...grounded];',
    expect: 'refit: a film whose timeline visits a box far smaller than its frame scales its things only as far as that box still takes the smallest of them, takes nothing out of the air as the box closes, and ends with some held',
  },
  {
    why: 'replay draws a responsive piece at its default box, whatever box the file names',
    file: 'tools/replay.js',
    from: "  if ((piece.boxes || manifest.reframe) && plan && typeof plan === 'object') {",
    to: '  if (false) {',
    expect: 'a piece that declares boxes replays at the box its file names, and refuses a box it does not accept',
  },
  {
    why: 'a contact sheet draws at the piece\'s own box whatever --box names, and refuses nothing',
    file: 'tools/contact-sheet.js',
    from: '  if (!box) return p;',
    to: '  return p;',
    expect: 'contact sheet: --box draws one piece at a box it declares, names the sheet after it, and refuses any other',
  },
  {
    why: 'a time strip shows the first frames only, not frames spread across the timeline',
    file: 'tools/contact-sheet.js',
    from: '    frames = Array.from({ length: strip.frames }, (_, i) => Math.round((i * (n - 1)) / (strip.frames - 1)));',
    to: '    frames = Array.from({ length: strip.frames }, (_, i) => i);',
    expect: 'contact sheet: --frames spreads a time strip from the first frame to the last at the piece seed, 640 px wide',
  },
  {
    why: 'a time strip draws its cells at the seed sheet\'s 480 px, too small to judge a film frame',
    file: 'tools/contact-sheet.js',
    from: '  const scale = strip.scale || STRIP_CELL / p.size.w;',
    to: '  const scale = strip.scale || 480 / p.size.w;',
    expect: 'contact sheet: --frames spreads a time strip from the first frame to the last at the piece seed, 640 px wide',
  },
  {
    why: 'a PNG of a time strip is 1280 px wide and cuts its columns',
    file: 'tools/contact-sheet.js',
    from: '  if (layout) return Math.max(1280, 48 + layout.columns * (layout.width + 2) + (layout.columns - 1) * 14);',
    to: '  if (layout) return 1280;',
    expect: 'contact sheet: --frames spreads a time strip from the first frame to the last at the piece seed, 640 px wide',
  },
  {
    why: 'a still gets a time strip that fails on its missing timeline instead of a refusal by name',
    file: 'tools/contact-sheet.js',
    from: '  if (!p.time && !(strip.at && strip.at.every((s) => s === 0))) {',
    to: '  if (false) {',
    expect: 'contact sheet: --frames spreads a time strip from the first frame to the last at the piece seed, 640 px wide',
  },
  {
    why: 'a still is refused a strip of its one frame, so it cannot be shown large with --scale or --loupe',
    file: 'tools/contact-sheet.js',
    from: '  if (!p.time && !(strip.at && strip.at.every((s) => s === 0))) {',
    to: '  if (!p.time) {',
    expect: 'contact sheet: a still takes --at 0, and with it --scale and --loupe, as a strip of its one frame',
  },
  {
    why: 'a --timeout-ms with no value swallows the next option as its number',
    file: 'tools/contact-sheet.js',
    from: "      if (!args[i + 1] || args[i + 1].startsWith('--')) throw refuse('--timeout-ms needs a number of milliseconds');",
    to: '',
    expect: 'contact sheet: --timeout-ms sets the --png browser limit and refuses a missing or wrong value by name',
  },
  {
    why: 'a sheet written again leaves the earlier -N-of-M parts of its name beside the new ones',
    file: 'tools/check-browser.js',
    from: '    if (earlier.test(name)) await removeImage(path.join(path.dirname(file), name), options);',
    to: '',
    expect: 'a sheet part written again removes the earlier parts of its name, whatever their count',
  },
  {
    why: 'a sheet part held open by a viewer aborts the capture instead of warning',
    file: 'tools/check-browser.js',
    from: "if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;",
    to: 'throw error;',
    expect: 'a sheet part held open by a viewer warns and the capture goes on',
  },
  {
    why: 'a second a hair under a whole frame in floating point is shown one frame early',
    file: 'tools/contact-sheet.js',
    from: '      const frame = Math.floor(s * hz + 1e-6);',
    to: '      const frame = Math.floor(s * hz);',
    expect: 'contact sheet: --at shows the frame each second falls in and refuses a second outside the film',
  },
  {
    why: 'a second past the film\'s end is drawn as a frame the film does not hold',
    file: 'tools/contact-sheet.js',
    from: '      if (!(s >= 0 && frame < n)) throw',
    to: '      if (!(s >= 0)) throw',
    expect: 'contact sheet: --at shows the frame each second falls in and refuses a second outside the film',
  },
  {
    why: 'the loupe crops the design box, not the film at its export scale',
    file: 'tools/contact-sheet.js',
    from: '    const k = filmScale(p), even = (v) => Math.max(2, 2 * Math.round(v / 2));',
    to: '    const k = 1, even = (v) => Math.max(2, 2 * Math.round(v / 2));',
    expect: 'contact sheet: --loupe crops a cell of the film at 100% of its default export scale',
  },
  {
    why: 'a loupe near the edge crops pixels outside the frame',
    file: 'tools/contact-sheet.js',
    from: 'sx: clamp(cx * k - w / 2, W - w)',
    to: 'sx: Math.round(cx * k - w / 2)',
    expect: 'contact sheet: --loupe crops a cell of the film at 100% of its default export scale',
  },
  {
    why: 'a time strip with --param silently ignores the swept parameter',
    file: 'tools/contact-sheet.js',
    from: '    if (paramNames.length) throw refuse(\'a time strip holds the seed and parameters; drop --param\');',
    to: '',
    expect: 'contact sheet: a time strip takes one piece and --frames or --at, and --scale and --loupe need one',
  },
  {
    why: 'seeds names an unknown option but gives no usage line after it',
    file: 'tools/contact-sheet.js',
    from: 'throw new Error(`seeds: unknown option ${arg}\\n${USAGE}`);',
    to: 'throw new Error(`seeds: unknown option ${arg}`);',
    expect: 'seeds: a refused argument is named, then the usage line',
  },
  {
    why: 'seeds refuses a fourth argument with the usage line alone',
    file: 'tools/contact-sheet.js',
    from: 'throw new Error(`seeds: unexpected argument "${positional[3]}"\\n${USAGE}`);',
    to: 'throw new Error(USAGE);',
    expect: 'seeds: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run seeds -- -h reads -h as a piece instead of printing the usage',
    file: 'tools/contact-sheet.js',
    from: " || process.argv.includes('-h')",
    to: '',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: '--out writes the film over any file it names, a piece or its data included',
    file: 'tools/film-cli.js',
    from: '  if (out.out !== null && !/\\.mp4$/i.test(out.out))',
    to: '  if (false)',
    expect: 'film: --out must name an .mp4, so a slip never replaces a piece or its data',
  },
  {
    why: 'a film cut short on its way from the page is written as if whole',
    file: 'tools/film-cli.js',
    from: '  if (bytes.length !== report.bytes) throw',
    to: '  if (false) throw',
    expect: 'film: the command writes the film and its report and prints one line; a film cut short writes nothing',
  },
  {
    why: '--bitrate is passed to the page as the scale',
    file: 'tools/film-cli.js',
    from: '      out.film[a.slice(2)] = n;',
    to: '      out.film.scale = n;',
    expect: 'film: arguments name one piece and pass --scale and --bitrate to the page unchanged',
  },
  {
    why: 'the page exports at its defaults whatever --scale and --bitrate say',
    file: 'tools/film-cli.js',
    from: '  const report = await api.film(opts);',
    to: '  const report = await api.film();',
    expect: 'film: the page function selects the piece, passes the options to the page\'s film() and returns its file as base64',
  },
  {
    why: 'npm run film -- --force no-h264 launches Edge for a film the page cannot make as MP4',
    file: 'tools/film-cli.js',
    from: "      if (force === 'no-h264') throw",
    to: "      if (false) throw",
    expect: 'film: --force passes one of the browser check\'s conditions to withEdge and refuses no-h264 by name',
  },
  {
    why: 'a forced film is reported and summarized as if nothing was forced',
    file: 'tools/film-cli.js',
    from: '  const forced = options.browser.force;',
    to: '  const forced = undefined;',
    expect: 'film: a forced film names its condition in its report and first in its summary line',
  },
  {
    why: 'an external piece\'s film lands in the library\'s out/, not beside the piece',
    file: 'tools/piece-input.js',
    from: '  if (within === null) return external.directory;',
    to: '  if (within === null) return path.join(ROOT, \'out\');',
    expect: 'film: a film goes under out/, beside an external piece, or where --out says from the caller',
  },
  {
    why: 'a piece inside the library, such as a test fixture, writes its page into its tracked folder',
    file: 'tools/piece-input.js',
    from: '  const within = inLibrary(external.directory);',
    to: '  const within = null;',
    expect: 'page: a piece inside the library writes its page under out/pieces/, one outside beside itself',
  },
  {
    why: 'npm run film -- -h reads -h as a piece instead of printing the usage',
    file: 'tools/film-cli.js',
    from: " || args.includes('-h')) return console.log(USAGE);",
    to: ') return console.log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run film refuses an option missing its value without naming the option',
    file: 'tools/film-cli.js',
    from: "throw refuse(args[i] + ' needs a value');",
    to: 'throw new Error(USAGE);',
    expect: 'film: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run film takes a second --force and films under the last one alone',
    file: 'tools/film-cli.js',
    from: "      if (out.browser.force) throw refuse('give --force only once');\n",
    to: '',
    expect: 'film: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run film refuses an unknown --force condition with the usage line alone',
    file: 'tools/film-cli.js',
    from: "throw refuse('--force takes no-aac or no-webgl2, got ' + force);",
    to: 'throw new Error(USAGE);',
    expect: 'film: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run film refuses an unknown option with the usage line alone',
    file: 'tools/film-cli.js',
    from: "    else if (a.startsWith('--')) throw refuse('unknown option ' + a);",
    to: '    else if (a.startsWith(\'--\')) throw new Error(USAGE);',
    expect: 'film: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run film refuses a second piece with the usage line alone',
    file: 'tools/film-cli.js',
    from: "throw refuse('one piece per film, got \"' + out.piece + '\" and \"' + a + '\"');",
    to: 'throw new Error(USAGE);',
    expect: 'film: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run film without a piece is refused with the usage line alone',
    file: 'tools/film-cli.js',
    from: "  if (!out.piece && !out.style) throw refuse('name the piece to film: an example or ./piece.cjs');",
    to: '  if (!out.piece && !out.style) throw new Error(USAGE);',
    expect: 'film: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run film with a piece and --style is refused with the usage line alone',
    file: 'tools/film-cli.js',
    from: "  if (out.piece && out.style) throw refuse('give a piece or --style, not both; got \"' + out.piece + '\" and --style ' + out.style);",
    to: '  if (out.piece && out.style) throw new Error(USAGE);',
    expect: 'film: a refused argument is named, then the usage line',
  },
  {
    why: 'npm --prefix … run film -- ./piece.cjs looks for the piece in the library, not where npm was run',
    file: 'tools/piece-input.js',
    from: "/^node tools\\/(?!run-tests\\.js)/.test(SCRIPTS[env.npm_lifecycle_event])",
    to: "/^node tools\\/(?!run-tests\\.js|film-cli)/.test(SCRIPTS[env.npm_lifecycle_event])",
    expect: 'external piece paths use the npm caller only for this library page/seeds script',
  },
  {
    why: 'npm run still -- ./piece.cjs --out still.svg looks for the piece and writes the file in the library, not where npm was run',
    file: 'tools/piece-input.js',
    from: "/^node tools\\/(?!run-tests\\.js)/.test(SCRIPTS[env.npm_lifecycle_event])",
    to: "/^node tools\\/(?!run-tests\\.js|still-cli)/.test(SCRIPTS[env.npm_lifecycle_event])",
    expect: 'still: under npm run, a relative piece and --out resolve from the caller\'s folder, and the replay hint replays from there',
  },
  {
    why: 'npm run test:all hands INIT_CWD to the tools its tests spawn with their own cwd, so their relative paths miss',
    file: 'tools/piece-input.js',
    from: "/^node tools\\/(?!run-tests\\.js)/.test(SCRIPTS[env.npm_lifecycle_event])",
    to: "/^node tools\\//.test(SCRIPTS[env.npm_lifecycle_event])",
    expect: 'still: under npm run, a relative piece and --out resolve from the caller\'s folder, and the replay hint replays from there',
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
    from: "  if (base.boxes && !current.reframe) q.push('box=' + current.size.w + 'x' + current.size.h);\n",
    to: '',
    expect: 'a piece that declares boxes opens at the address bar\'s box, rebuilds from its sliders and records the box',
  },
  {
    why: 'npm run page -- -h reads -h as a piece instead of printing the usage',
    file: 'tools/build-page.js',
    from: " || args.includes('-h')) return console.log(USAGE);",
    to: ') return console.log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run page -- --style without a name is refused with the usage line alone',
    file: 'tools/build-page.js',
    from: "  if (style && (!args[1] || args[1].startsWith('--'))) throw refuse('--style needs a style name; npm run styles lists them');",
    to: "  if (style && (!args[1] || args[1].startsWith('--'))) throw new Error(USAGE);",
    expect: 'page: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run page refuses an unknown option with the usage line alone',
    file: 'tools/build-page.js',
    from: "  if (option) throw refuse('unknown option ' + option);",
    to: '  if (option) throw new Error(USAGE);',
    expect: 'page: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run page refuses a second piece with the usage line alone',
    file: 'tools/build-page.js',
    from: "throw refuse('one piece per page, got \"' + args.slice(style ? 1 : 0).join('\" and \"') + '\"');",
    to: 'throw new Error(USAGE);',
    expect: 'page: a refused argument is named, then the usage line',
  },
  ...['compareFilm(bytes, recipe, frames, first = 0)', 'compareSound(bytes, recipe, block, codec, band, flatness, cut, voice, mask, span = null, sparse = null)', 'comparePng(bytes, recipe, heads, frames)', 'compareWebm(bytes, recipe, frames, seeks)'].map((head) => ({
    why: `replay's ${head.split('(')[0]} redraws a responsive piece at its default box, whatever box the file names`,
    file: 'tools/replay.js',
    from: `async function ${head} {\n  const api = window.__artifex;\n`
      + "  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));\n"
      + '  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.reframe || recipe.size);',
    to: `async function ${head} {\n  const api = window.__artifex;\n`
      + "  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));\n"
      + '  const p = api.piece.validate(api.examples[recipe.piece]);',
    expect: 'the page redraws a responsive film, its soundtrack, a PNG or a WebM at the box its recipe records',
  })),
  {
    why: 'npm run replay -- -h reads -h as the file to replay instead of printing the usage',
    file: 'tools/replay.js',
    from: " || args.includes('-h')) return console.log(USAGE);",
    to: ') return console.log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run replay refuses an unknown option with the usage line alone',
    file: 'tools/replay.js',
    from: "    else if (a.startsWith('--')) throw refuse('unknown option ' + a);",
    to: '    else if (a.startsWith(\'--\')) throw new Error(USAGE);',
    expect: 'replay: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run replay refuses a second file with the usage line alone',
    file: 'tools/replay.js',
    from: "throw refuse('one file at a time, got \"' + out.file + '\" and \"' + a + '\"');",
    to: 'throw new Error(USAGE);',
    expect: 'replay: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run replay without a file is refused with the usage line alone',
    file: 'tools/replay.js',
    from: "  if (!out.file) throw refuse('name the SVG, PNG, MP4 or WebM file to replay');",
    to: '  if (!out.file) throw new Error(USAGE);',
    expect: 'replay: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run replay refuses an option without its value with the usage line alone',
    file: 'tools/replay.js',
    from: "throw refuse(name + ' needs ' + cause);",
    to: 'throw new Error(USAGE);',
    expect: 'replay: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run bench -- -h is refused as an unexpected argument instead of printing the usage',
    file: 'tools/bench.js',
    from: " || args.includes('-h')) console.log(USAGE);",
    to: ') console.log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run bench refuses an argument with the usage line alone',
    file: 'tools/bench.js',
    from: "console.error('bench: ' + (args[0].startsWith('-') ? 'unknown option ' + args[0] : 'unexpected argument \"' + args[0] + '\"') + '\\n' + USAGE);",
    to: 'console.error(USAGE);',
    expect: 'bench, examples and lint: a refused argument is named, then the usage line, and nothing runs',
  },
  {
    why: 'npm run bench calls an unknown option an unexpected argument',
    file: 'tools/bench.js',
    from: "(args[0].startsWith('-') ? 'unknown option ' + args[0] : 'unexpected argument \"' + args[0] + '\"')",
    to: "('unexpected argument \"' + args[0] + '\"')",
    expect: 'bench, examples and lint: a refused argument is named, then the usage line, and nothing runs',
  },
  {
    why: 'npm run examples -- -h is refused as an unexpected argument instead of printing the usage',
    file: 'tools/render-examples.js',
    from: " || args.includes('-h')) console.log(USAGE);",
    to: ') console.log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run examples refuses an argument with the usage line alone',
    file: 'tools/render-examples.js',
    from: "console.error('examples: ' + (args[0].startsWith('-') ? 'unknown option ' + args[0] : 'unexpected argument \"' + args[0] + '\"') + '\\n' + USAGE);",
    to: 'console.error(USAGE);',
    expect: 'bench, examples and lint: a refused argument is named, then the usage line, and nothing runs',
  },
  {
    why: 'npm run examples calls an unknown option an unexpected argument',
    file: 'tools/render-examples.js',
    from: "(args[0].startsWith('-') ? 'unknown option ' + args[0] : 'unexpected argument \"' + args[0] + '\"')",
    to: "('unexpected argument \"' + args[0] + '\"')",
    expect: 'bench, examples and lint: a refused argument is named, then the usage line, and nothing runs',
  },
  {
    why: 'npm run lint -- -h is refused as an unexpected argument instead of printing the usage',
    file: 'tools/lint-unread.js',
    from: " || args.includes('-h')) console.log(USAGE);",
    to: ') console.log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run lint refuses an argument with the usage line alone',
    file: 'tools/lint-unread.js',
    from: "console.error('lint: ' + (args[0].startsWith('-') ? 'unknown option ' + args[0] : 'unexpected argument \"' + args[0] + '\"') + '\\n' + USAGE);",
    to: 'console.error(USAGE);',
    expect: 'bench, examples and lint: a refused argument is named, then the usage line, and nothing runs',
  },
  {
    why: 'npm run lint calls an unknown option an unexpected argument',
    file: 'tools/lint-unread.js',
    from: "(args[0].startsWith('-') ? 'unknown option ' + args[0] : 'unexpected argument \"' + args[0] + '\"')",
    to: "('unexpected argument \"' + args[0] + '\"')",
    expect: 'bench, examples and lint: a refused argument is named, then the usage line, and nothing runs',
  },
  {
    why: 'npm run lint passes an unread destructured import because its name is read in the module it came from',
    file: 'tools/lint-unread.js',
    from: "const seen = kind === 'destructured' ? local.filter((t) => t === name).length - (members.get(name) || 0) : counts.get(name) || 0;",
    to: 'const seen = counts.get(name) || 0;',
    expect: 'lint: a destructured name its file never reads is reported, a read one is not',
  },
  {
    why: 'npm run lint passes an unread destructured binding because a class member of its file shares its name',
    file: 'tools/lint-unread.js',
    from: "if (names.get(m[1]) !== 'destructured') names.set(m[1], 'member');",
    to: "names.set(m[1], 'member');",
    expect: 'lint: a class member named like a destructured binding does not read it',
  },
  {
    why: 'npm run lint passes a name that only a comment, a string or a regular expression mentions',
    file: 'tools/lint-unread.js',
    from: '  files = files.map(([file, src]) => [file, readable(file, src)]);\n',
    to: '',
    expect: 'lint: a name in a comment, a string or a regular expression is not a reader',
  },
  {
    why: "npm run lint reports a name that only the page's browser code reads, because it blanks that code as template text",
    file: 'tools/lint-unread.js',
    from: "  ['tools/build-page.js', /<script>\\n([^`]*)<\\/script>/],\n",
    to: '',
    expect: "lint: the page's browser code in a template is source, its other templates are not",
  },
  {
    why: 'npm run replay -- a.png --piece --json loads a module named --json',
    file: 'tools/replay.js',
    from: "if (!v || v.startsWith('--')) throw refuse(name",
    to: "if (!v) throw refuse(name",
    expect: 'replay: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run replay -- a.png --edge --json launches an Edge named --json',
    file: 'tools/replay.js',
    from: "out.browser.edge = value(a, 'the path to msedge');",
    to: 'out.browser.edge = args[++i];',
    expect: 'replay: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run replay -- a.png --timeout-ms --json reads --json as the timeout and refuses with the range message',
    file: 'tools/replay.js',
    from: "const ms = value(a, 'a number of milliseconds');",
    to: 'const ms = args[++i];',
    expect: 'replay: --timeout-ms without a value is named, not read from the next option',
  },
  {
    why: 'npm run page -- a.cjs --style dots calls --style an unknown option',
    file: 'tools/build-page.js',
    from: "  if (late > 0 && !args[0].startsWith('--')) throw refuse(",
    to: '  if (false) throw refuse(',
    expect: 'page: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run page -- --bogus --style dots calls --bogus a piece',
    file: 'tools/build-page.js',
    from: "  if (late > 0 && !args[0].startsWith('--')) throw refuse(",
    to: '  if (late > 0) throw refuse(',
    expect: 'page: a refused argument is named, then the usage line',
  },
  {
    why: 'a second npm run film --force no-h264 explains WebM instead of saying one --force is taken',
    file: 'tools/film-cli.js',
    from: "      if (out.browser.force) throw refuse('give --force only once');\n      // Without H.264 the page offers only its WebM recording, which this command does not save.\n      if (force === 'no-h264') throw refuse('--force no-h264 leaves the page only its WebM recording, which npm run film does not save; check that recording with npm run browser -- --force no-h264, which takes no piece and records the first film its run exports');\n",
    to: "      // Without H.264 the page offers only its WebM recording, which this command does not save.\n      if (force === 'no-h264') throw refuse('--force no-h264 leaves the page only its WebM recording, which npm run film does not save; check that recording with npm run browser -- --force no-h264, which takes no piece and records the first film its run exports');\n      if (out.browser.force) throw refuse('give --force only once');\n",
    expect: 'film: a refused argument is named, then the usage line',
  },
  {
    why: 'a heading the skill links to is renamed, and the link still points at the old anchor',
    file: 'skills/artifex/reference/making.md',
    from: '[stills](stills.md#looks-to-leave-out)',
    to: '[stills](stills.md#looks-to-avoid)',
    expect: 'every relative link and anchor in the skills resolves',
  },
  {
    why: 'npm run posters -- -h is refused as an unknown option instead of printing the usage',
    file: 'tools/posters.js',
    from: " || args.includes('-h')) return console.log(USAGE);",
    to: ') return console.log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run posters refuses --edge without a path with the usage line alone',
    file: 'tools/posters.js',
    from: "throw refuse('--edge needs the path to msedge');",
    to: 'throw new Error(USAGE);',
    expect: 'posters: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run posters refuses a short --timeout-ms with the usage line alone',
    file: 'tools/posters.js',
    from: "timeoutArg(args[++i] ?? 'nothing', refuse, {",
    to: "timeoutArg(args[++i] ?? 'nothing', () => new Error(USAGE), {",
    expect: 'posters: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run posters accepts a --timeout-ms under 1000 ms',
    file: 'tools/posters.js',
    from: '{ min: 1000, max: 2147483647, fallback: 120000 }',
    to: '{ max: 2147483647, fallback: 120000 }',
    expect: 'posters: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run posters holds --timeout-ms to the default 300000 ms cap instead of setTimeout\'s limit',
    file: 'tools/posters.js',
    from: '{ min: 1000, max: 2147483647, fallback: 120000 }',
    to: '{ min: 1000, fallback: 120000 }',
    expect: 'posters: a refused argument is named, then the usage line',
  },
  {
    why: 'the site check accepts a --timeout-ms under 1000 ms',
    file: 'tools/check-site.js',
    from: "{ min: 1000, max: 2147483647, fallback: '250 a frame, 300000 at least' }",
    to: "{ max: 2147483647, fallback: '250 a frame, 300000 at least' }",
    expect: 'site check: a --timeout-ms under 1000 ms or past setTimeout\'s limit is named, then the usage line',
  },
  {
    why: 'the site check holds --timeout-ms to the default 300000 ms cap instead of setTimeout\'s limit',
    file: 'tools/check-site.js',
    from: "{ min: 1000, max: 2147483647, fallback: '250 a frame, 300000 at least' }",
    to: "{ min: 1000, fallback: '250 a frame, 300000 at least' }",
    expect: 'site check: a --timeout-ms under 1000 ms or past setTimeout\'s limit is named, then the usage line',
  },
  {
    why: 'npm run posters refuses an unknown option with the usage line alone',
    file: 'tools/posters.js',
    from: "    else throw refuse('unknown option ' + args[i]);",
    to: '    else throw new Error(USAGE);',
    expect: 'posters: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run site -- -h is refused as an unknown option instead of printing the usage',
    file: 'tools/build-site.js',
    from: " || args.includes('-h')) return console.log(USAGE);",
    to: ') return console.log(USAGE);',
    expect: 'every tool prints its usage and exits 0 for --help and -h',
  },
  {
    why: 'npm run site refuses a port out of range with the usage line alone',
    file: 'tools/build-site.js',
    from: "throw refuse('--port needs a port number from 0 to 65535, got ' + (args[i + 1] ?? 'nothing'));",
    to: 'throw new Error(USAGE);',
    expect: 'site: a refused argument is named, then the usage line',
  },
  {
    why: 'npm run site refuses an unknown option with the usage line alone',
    file: 'tools/build-site.js',
    from: "    else throw refuse('unknown option ' + args[i]);",
    to: '    else throw new Error(USAGE);',
    expect: 'site: a refused argument is named, then the usage line',
  },
  {
    why: 'a download\'s blob URL is revoked a second after the click, which can cut a slow download of a large file',
    file: 'core/export.js',
    from: '  a.click();\n}',
    to: '  a.click();\n  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);\n}',
    expect: 'a download keeps its blob URL until the next save or until the page is hidden, never on a timer',
  },
  {
    why: 'every download\'s blob URL is kept until the page is hidden, holding every file saved in memory',
    file: 'core/export.js',
    from: "  addEventListener('pagehide', revokeSaved);\n  revokeSaved();\n",
    to: "  addEventListener('pagehide', revokeSaved);\n",
    expect: 'a download keeps its blob URL until the next save or until the page is hidden, never on a timer',
  },
  {
    why: 'a PNG is named without its scale, so a 1x and an 8x of one frame take the same name',
    file: 'core/export.js',
    from: "  if (kind === 'png') return stem + '@' + extra + 'x.png';",
    to: "  if (kind === 'png') return stem + '.png';",
    expect: 'a saved file is named by piece, seed and kind, the same from the page and the site',
  },
  {
    why: 'a box timeline may put two boxes at one playhead, a cut',
    file: 'core/piece.js',
    from: '    if (i && !(k.t > v[i - 1].t)) return',
    to: '    if (i && !(k.t >= v[i - 1].t)) return',
    expect: 'a box timeline is refused by name unless it moves, fits the boxes and keeps the largest as the frame',
  },
  {
    why: 'a box timeline may name a box the piece does not accept',
    file: 'core/piece.js',
    from: '    if (off) return `box ${i}, ${keys[i].w} x ${keys[i].h}: ${off}`;',
    to: '    if (false) return `box ${i}, ${keys[i].w} x ${keys[i].h}: ${off}`;',
    expect: 'a box timeline is refused by name unless it moves, fits the boxes and keeps the largest as the frame',
  },
  {
    why: 'a box timeline plays in a frame smaller than its largest box',
    file: 'core/piece.js',
    from: '    if (f.w !== out.size.w || f.h !== out.size.h) {',
    to: '    if (false) {',
    expect: 'a box timeline is refused by name unless it moves, fits the boxes and keeps the largest as the frame',
  },
  {
    why: 'the box jumps between two boxes at constant speed instead of moving rest to rest',
    file: 'core/piece.js',
    from: '  const e = ease.smooth(u);',
    to: '  const e = u;',
    expect: 'a box timeline moves the box rest to rest, centred in its frame, and holds it at either end',
  },
  {
    why: 'the box sits in the frame\'s corner instead of its centre',
    file: 'core/piece.js',
    from: '  return { w, h, x: (piece.size.w - w) / 2, y: (piece.size.h - h) / 2, from, to, u };',
    to: '  return { w, h, x: 0, y: 0, from, to, u };',
    expect: 'a box timeline moves the box rest to rest, centred in its frame, and holds it at either end',
  },
  {
    why: 'a recipe drawn along a box timeline does not name it, so replay draws another film',
    file: 'core/piece.js',
    from: '  if (piece.reframe) m.reframe = piece.reframe.map(keyOf);\n  // So is every image',
    to: '  // So is every image',
    expect: 'a box timeline moves the box rest to rest, centred in its frame, and holds it at either end',
  },
  {
    why: 'one box at the piece\'s own size keeps its timeline playing',
    file: 'core/piece.js',
    from: '  if (box.w === piece.size.w && box.h === piece.size.h) return piece.reframe ? { ...piece, reframe: null } : piece;',
    to: '  if (box.w === piece.size.w && box.h === piece.size.h) return piece;',
    expect: 'atBox plays a box timeline, and one box replaces a timeline, even at the piece\'s own size',
  },
  {
    why: 'replay draws a file along the piece\'s own box timeline, whatever timeline the file names',
    file: 'tools/replay.js',
    from: '  const plan = manifest.reframe || manifest.size;',
    to: '  const plan = manifest.size;',
    expect: 'a file drawn along a box timeline replays along the timeline it names, and one drawn at one box at that box',
  },
  {
    why: 'the page redraws a film at its frame without the box timeline its recipe names',
    file: 'tools/replay.js',
    from: '  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.reframe || recipe.size);\n  const solved = api.piece.solve(p, recipe.seed, recipe.params);\n  const W = Math.round(p.size.w * recipe.scale)',
    to: '  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.size);\n  const solved = api.piece.solve(p, recipe.seed, recipe.params);\n  const W = Math.round(p.size.w * recipe.scale)',
    expect: 'the page redraws a responsive film, its soundtrack, a PNG or a WebM at the box its recipe records',
  },
  {
    why: 'refit\'s left wall stands outside the line it draws, so things rest beyond it',
    file: 'examples/refit.js',
    from: '  const L0 = a.x + ca.x0, L1 = b.x + cb.x0;',
    to: '  const L0 = a.x + ca.x0 - 20, L1 = b.x + cb.x0 - 20;',
    expect: 'refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim',
  },
  {
    why: 'refit cuts out what no longer fits instead of shrinking it away',
    file: 'examples/refit.js',
    from: '        if (f >= th.gone + FADE) return null;',
    to: '        if (f >= th.gone) return null;',
    expect: 'refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim',
  },
  {
    why: 'refit keeps a thing that landed with its centre over the rim, so the pile stands out of its container',
    file: 'examples/refit.js',
    from: '            if (goes.has(k) || (y < -th.r && y < s.frames[f - 1][3 * k + 1])) { th.gone = f; area -= Math.PI * th.r * th.r; calm = false; }',
    to: '            if (false) { th.gone = f; area -= Math.PI * th.r * th.r; calm = false; }',
    expect: 'refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim',
  },
  {
    why: 'refit rains things in from above the frame again when a box widens after the first fill, instead of filling the room it opens in place',
    file: 'examples/refit.js',
    from: '          if (filled) {',
    to: '          if (false) {',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, its own film',
  },
  {
    why: 'refit pops a thing that appears after the first fill in at its full size instead of growing it from nothing',
    file: 'examples/refit.js',
    from: '      const scale = grown(th, f);\n      return { x: snap[3 * k], y: snap[3 * k + 1] + th.r * (1 - scale), r: th.r * scale, turn: snap[3 * k + 2], scale };',
    to: '      const scale = 1;\n      return { x: snap[3 * k], y: snap[3 * k + 1], r: th.r, turn: snap[3 * k + 2], scale };',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, its own film',
  },
  {
    why: 'refit places a thing after the first fill in a cradle whose two things are drawing apart as a widening box lets the pile slump, so the thing falls between them as it grows',
    file: 'examples/refit.js',
    from: '              if ((now + (now - then) * HZ * span / 2) * span > SPREAD) continue;',
    to: '              if (false) continue;',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, its own film',
  },
  {
    why: 'refit places a thing after the first fill against a wall that is moving away, so the thing rolls off the thing beside it as it grows',
    file: 'examples/refit.js',
    from: '              if (inL === L && xa >= inL + r && xa - inL - r < ra) take(',
    to: '              if (xa >= inL + r && xa - inL - r < ra) take(',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, its own film',
  },
  {
    why: 'refit starts a thing born on the floor still while the box grows taller, so the floor descends from under it and it hangs in the air as it grows',
    file: 'examples/refit.js',
    from: '          const sink = (floor - inFloor) * HZ;',
    to: '          const sink = 0;',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, square to wide and taller',
  },
  {
    why: 'refit grows a thing that appears after the first fill about its centre, so while it is small it floats over what holds it',
    file: 'examples/refit.js',
    from: '      return { x: snap[3 * k], y: snap[3 * k + 1] + th.r * (1 - scale), r: th.r * scale, turn: snap[3 * k + 2], scale };',
    to: '      return { x: snap[3 * k], y: snap[3 * k + 1], r: th.r * scale, turn: snap[3 * k + 2], scale };',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, its own film',
  },
  {
    why: 'refit gives a thing that appears after the first fill its whole weight at once, so while it is still growing it presses what cradles it apart and sinks between them',
    file: 'examples/refit.js',
    from: 'radius: things[k].r, mass: (things[k].r * grown(things[k], f)) ** 2 })),',
    to: 'radius: things[k].r, mass: things[k].r ** 2 })),',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, its own film',
  },
  {
    why: 'refit latches a still box full after the first fill while its pile is still slumping, so the room a widening opened stays half empty',
    file: 'examples/refit.js',
    from: '{ full = resting || area + Math.PI * small * small > cap; break; }',
    to: '{ full = true; break; }',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, portrait to wide',
  },
  {
    why: 'refit ends its first fill on a frame its widening box is full only for the things still falling in, so it grows things in place while the rain should go on',
    file: 'examples/refit.js',
    from: '{ full = true; filled = !moving; break; }',
    to: '{ full = filled = true; break; }',
    expect: 'refit: a box that widens while the container is still filling loses nothing, keeps taking things and ends as full as a box of that size',
  },
  {
    why: 'refit grows things in place while things its first fill released are still falling, so one can grow where a falling thing then lands',
    file: 'examples/refit.js',
    from: '            if (things.some((th) => th.landed === Infinity && th.gone === Infinity)) break;',
    to: '            if (false) break;',
    expect: 'refit: the first fill is over the first time a still box is full, even while its last drops still fall: a box that then widens releases nothing more, and nothing grows until they have landed',
  },
  {
    why: 'refit ends its first fill only once every thing it released has landed, so a box that widens with its last drops still in the air rains on into the room it opens',
    file: 'examples/refit.js',
    from: '{ full = true; filled = !moving; break; }',
    to: '{ full = true; filled = !moving && things.every((th) => th.landed < Infinity || th.gone < Infinity); break; }',
    expect: 'refit: the first fill is over the first time a still box is full, even while its last drops still fall: a box that then widens releases nothing more, and nothing grows until they have landed',
  },
  {
    why: 'refit grows things in place up to the frame the walls narrow, so one born just before a narrowing is squeezed out while it grows and pops, its shrink starting from its full size',
    file: 'examples/refit.js',
    from: '            if (f + FADE >= narrows[f]) break;',
    to: '            if (false) break;',
    expect: 'refit: growth waits for a coming narrowing, as the rain does, so nothing born just before one is squeezed out while it grows and pops',
  },
  {
    why: 'refit draws a thing held by others up from its own lowest point, so it hangs over a holder drawn small and over the gap of a cradle',
    file: 'examples/refit.js',
    from: '      if (!holders.length) return;',
    to: '      if (holders) return;',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, its own film',
  },
  {
    why: 'refit grows a thing held by several things from its contact with the first-born of them instead of the last-born',
    file: 'examples/refit.js',
    from: '      const j = holders.at(-1);',
    to: '      const j = holders[0];',
    expect: 'refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, its own film',
  },
  {
    why: 'refit shrinks a thing that no longer fits about its own centre where it went, so it floats off what held it while it shrinks',
    file: 'examples/refit.js',
    from: '            for (const [k, touches] of ready) { things[k].from = touches.find(settled); left--; }',
    to: '            for (const [k, touches] of ready) { things[k].from = undefined; left--; }',
    expect: 'refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim',
  },
  {
    why: 'refit shrinks a thing that no longer fits from the last contact it finds instead of its lowest',
    file: 'examples/refit.js',
    from: '            return touches.sort((a, b) => b[1] - a[1]).map(([j]) => j);',
    to: '            return touches.reverse().map(([j]) => j);',
    expect: 'refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim',
  },
  {
    why: 'refit lets two things that go on the same frame each shrink from the other, so the pair shrinks tied to nothing else and floats off what held it',
    file: 'examples/refit.js',
    from: '          const settled = (j) => j < 0 || !goes.has(j) || things[j].from !== undefined;',
    to: '          const settled = () => true;',
    expect: 'refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim',
  },
  {
    why: 'refit lets a thing that goes with others shrink from any settled contact instead of waiting for its lowest, a thing going on the same frame that does not shrink from it',
    file: 'examples/refit.js',
    from: '            const ready = [...goes].filter(([k, touches]) => things[k].from === undefined && settled(touches[0]));',
    to: '            const ready = [...goes].filter(([k, touches]) => things[k].from === undefined && touches.some(settled));',
    expect: 'refit: a box that closes fast under a tall box stops the rain in time to land before the walls move, so nothing is jammed into a column above the rim or taken in one flash',
  },
  {
    why: 'refit keeps a thing shrinking against a wall at the height it went, so the closing box lowers the wall\'s lip past it and it floats beside no drawn wall',
    file: 'examples/refit.js',
    from: '        at.y = Math.max(touch, rim - LIP) + reach * dy / d;',
    to: '        at.y = touch + reach * dy / d;',
    expect: 'refit: a box that closes fast under a tall box stops the rain in time to land before the walls move, so nothing is jammed into a column above the rim or taken in one flash',
  },
  {
    why: 'the WebM export waits for ever on a recorder that never answers requestData',
    file: 'core/export.js',
    from: '  return Promise.race([asked, late]).finally(function () { clearTimeout(timer); });',
    to: '  return asked;',
    expect: 'a WebM recorder that never answers requestData fails the export by name after 10 s, in the warm-up and in the film',
  },
  {
    why: 'the WebM export waits for ever on a recorder that never fires stop at the end of the film',
    file: 'core/export.js',
    from: "    await bounded(finished, 'the recorder was stopped at the end of the film and did not finish');",
    to: '    await finished;',
    expect: 'a WebM recorder that never fires stop fails the export by name after 10 s, in the warm-up and in the film',
  },
  {
    why: 'spaced streamlines let a later trace come within half the separation of an earlier one',
    file: 'core/field.js',
    from: '          if ((px - x) ** 2 + (py - y) ** 2 < separation * separation) return false;',
    to: '          if ((px - x) ** 2 + (py - y) ** 2 < separation * separation / 4) return false;',
    expect: 'streamlines with a separation keep every point at least that far from every earlier trace',
  },
  {
    why: 'the spacing lookup reads only its own bucket row and misses earlier points just across a bucket edge',
    file: 'core/field.js',
    from: '    for (let dj = -1; dj <= 1; dj++) {',
    to: '    for (let dj = 0; dj <= 0; dj++) {',
    expect: 'streamlines with a separation keep every point at least that far from every earlier trace',
  },
  {
    why: 'a seed on an earlier trace starts anyway and leaves a one-point stub',
    file: 'core/field.js',
    from: '  if (steps === 0 || outside(x, y) || (free && !free(x, y))) return [];',
    to: '  if (steps === 0 || outside(x, y)) return [];',
    expect: 'streamlines with a separation stop at the seed cap and report refused seeds as empty entries',
  },
  {
    why: 'a joined film plays each later scene\'s priming in the middle of the film',
    file: 'tools/stitch.js',
    from: '    if (k) while (skip < durations.length',
    to: '    if (false) while (skip < durations.length',
    expect: 'joined AAC films keep every frame in order and cut their soundtracks on packets, each scene sounding on its first frame or up to a packet after',
  },
  {
    why: 'a joined film\'s scene sounds up to half a packet before its first frame',
    file: 'tools/stitch.js',
    from: 'j < durations.length && media < until; j++',
    to: 'j < durations.length && media + durations[j] / 2 < until; j++',
    expect: 'joined AAC films keep every frame in order and cut their soundtracks on packets, each scene sounding on its first frame or up to a packet after',
  },
  {
    why: 'replay judges an Opus scene where the scene before still colours it',
    file: 'tools/stitch.js',
    from: 'const SETTLE = { mp4a: 1, Opus: 10 };',
    to: 'const SETTLE = { mp4a: 1, Opus: 1 };',
    expect: 'joined Opus films keep every packet of a scene that lasts whole packets, and judge each later scene from its tenth packet',
  },
  {
    why: 'films of two H.264 configurations are joined under the first one\'s',
    file: 'tools/stitch.js',
    from: '  if (!sameBytes(b.video.entry, a.video.entry)) refuse(',
    to: '  if (false) refuse(',
    expect: 'films that one decoder cannot play alike, or that Artifex did not export, are refused by name',
  },
  {
    why: 'replay hears a joined film\'s scene from the film\'s start, not where it lies',
    file: 'tools/replay.js',
    from: 'const from = span ? span.from : 0, shift = span ? span.at : 0;',
    to: 'const from = span ? span.from : 0, shift = 0;',
    expect: 'replay judges a scene\'s sound where the joined film says it lies, and only the samples its own packets made',
  },
  {
    why: 'replay seeks a joined film\'s scene from the film\'s first frame',
    file: 'tools/replay.js',
    from: 'video.currentTime = (first + i + 0.5) / p.time.hz;',
    to: 'video.currentTime = (i + 0.5) / p.time.hz;',
    expect: 'replay seeks each scene of a joined film from the scene\'s own first frame',
  },
  {
    why: 'npm run film -- --reframe starts Edge with a box timeline the piece cannot play instead of refusing it by name',
    file: 'tools/film-cli.js',
    from: "  try { atBox(validate(external ? external.piece : EXAMPLES[name]), options.reframe); }\n  catch (e) { throw refuse('--reframe: ' + e.message.replace(/^atBox: /, '')); }\n",
    to: '',
    expect: 'film: --reframe reads a box timeline written t:WxH,... and atBox refuses one the piece cannot play by name before Edge starts',
  },
  {
    why: 'npm run film asks every piece for a contact strip, so one that keeps no contact list is sent a --contacts command npm run seeds refuses',
    file: 'tools/film-cli.js',
    from: " || (look === 'contacts' && !contacts.length) ||",
    to: ' ||',
    expect: 'film: the save names each look npm run seeds has not drawn since the piece changed, and the fresh-eyes review, in its report and on stderr',
  },
  {
    why: 'npm run film saved at --seed 7 advises strips at the piece\'s own seed',
    file: 'tools/film-cli.js',
    from: "look === 'seeds' ? '' : seed,",
    to: "'',",
    expect: 'film: the save names each look npm run seeds has not drawn since the piece changed, and the fresh-eyes review, in its report and on stderr',
  },
  {
    why: 'npm run film saved at --seed 7 counts strips drawn at the piece\'s own seed as drawn',
    file: 'tools/film-cli.js',
    from: "if (!m || (m[2] ?? '') !== (m[1] === 'seeds' ? '' : seed) || (m[4] ?? '') !== box) continue;",
    to: 'if (!m) continue;',
    expect: 'film: the save names each look npm run seeds has not drawn since the piece changed, and the fresh-eyes review, in its report and on stderr',
  },
  {
    why: 'npm run film --reframe names a contact list from the piece at its own size, which npm run seeds --reframe refuses',
    file: 'tools/film-cli.js',
    from: 'const p = target.reframe ? atBox(own, target.reframe) : own;',
    to: 'const p = own;',
    expect: 'film: the save names each look npm run seeds has not drawn since the piece changed, and the fresh-eyes review, in its report and on stderr',
  },
  {
    why: 'the page drops a refused reframe from the address bar silently, so nobody learns why the film plays another box',
    file: 'tools/build-page.js',
    from: '  if (refused && !err.textContent) err.textContent = refused;\n',
    to: '',
    expect: 'the address bar\'s reframe, t:WxH,..., plays a box timeline, is refused by name through atBox, and the player plays a timeline fitted whole',
  },
  {
    why: 'the live player swaps a box timeline for the window\'s box, so the reframe a film shows cannot be previewed',
    file: 'tools/build-page.js',
    from: '  if (base.boxes && !current.reframe) {\n    var clampTo',
    to: '  if (base.boxes) {\n    var clampTo',
    expect: 'the address bar\'s reframe, t:WxH,..., plays a box timeline, is refused by name through atBox, and the player plays a timeline fitted whole',
  },
  {
    why: 'replay opens a page and sends the whole film again for each scene of a joined film',
    file: 'tools/replay.js',
    from: 'const results = await replayMp4(bytes, films, external, options.browser, options.withEdge, grab);',
    to: 'const results = []; for (const f of films) results.push(...await replayMp4(bytes, [f], external, options.browser, options.withEdge, grab));',
    expect: 'replay compares every scene of a joined film of registered examples in one page, sent the film once',
  },
  {
    why: 'the NV12 dither spans a whole level either way, so a sample can round two levels off',
    file: 'core/film.js',
    from: 'return ((h >>> 8) + 0.5) / 16777216 - 0.5;',
    to: 'return ((h >>> 8) + 0.5) / 8388608 - 1;',
    expect: 'the NV12 dither is under half a level either way, mean zero, and the same for the same sample',
  },
  {
    why: 'each scene of a joined film decodes the whole joined soundtrack again in the replay page',
    file: 'tools/replay.js',
    from: 'decoded = await (kept.sound = kept.sound || new OfflineAudioContext',
    to: 'decoded = await (kept.sound = new OfflineAudioContext',
    expect: 'replay decodes a joined film\'s soundtrack and makes its object URL once per page, for all its scenes',
  },
  {
    why: "a time strip forces each timed draw by reading its cell, which moves a GPU canvas to the CPU so the cell no longer shows the film's pixels",
    file: 'tools/contact-sheet.js',
    from: 'pixel.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);\n            pixel.getImageData(0, 0, 1, 1);',
    to: 'g.getImageData(0, 0, 1, 1);',
    expect: 'contact sheet: a strip times each draw without reading its cell, which would move a GPU canvas to the CPU',
  },
  {
    why: 'the scaffold moves every element with the camera alike, so a sky at depth 0 slides with the subject',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '      const depth = e.depth === undefined ? 1 : e.depth;',
    to: '      const depth = 1;',
    expect: 'the film scaffold moves its camera rest to rest between keys, cuts on two keys at one second, and offsets each element by its depth',
  },
  {
    why: 'the scaffold zooms linearly between keys, so a zoom speeds up as it widens',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'zoom: a.zoom * (b.zoom / a.zoom) ** u };',
    to: 'zoom: a.zoom + (b.zoom - a.zoom) * u };',
    expect: 'the film scaffold moves its camera rest to rest between keys, cuts on two keys at one second, and offsets each element by its depth',
  },
  {
    why: 'the scaffold pans evenly through a deep zoom, so the target slides out of the frame mid-move',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '  const p = Math.abs(L) < 1e-9 ? u : Math.expm1(-u * L) / Math.expm1(-L);',
    to: '  const p = u;',
    expect: 'the film scaffold keeps the target of a key that pans and zooms deep in frame, and moves a key that only pans or only zooms evenly',
  },
  {
    why: 'the scaffold paths a pan by the change in zoom alone, so a pan through a deep dolly throws the target out of frame',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '  const L = Math.log(b.zoom / a.zoom) + Math.log(b.dolly / a.dolly);',
    to: '  const L = Math.log(b.zoom / a.zoom);',
    expect: 'the film scaffold keeps the target of a key that pans and zooms deep in frame, and moves a key that only pans or only zooms evenly',
  },
  {
    why: 'the scaffold paths a pan by the ratio of scales, which rounding leaves a hair off 1 through a dolly-zoom, so the pan holds still and then jumps',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '  const p = Math.abs(L) < 1e-9 ? u : Math.expm1(-u * L) / Math.expm1(-L);',
    to: '  const r = Math.exp(L);\n  const p = r === 1 ? u : (1 - r ** -u) / (1 - r ** -1);',
    expect: 'the film scaffold keeps the target of a key that pans and zooms deep in frame, and moves a key that only pans or only zooms evenly',
  },
  {
    why: 'the scaffold takes camera keys out of order, so the view jumps back',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '(i === 0 || k.at >= CAMERA[i - 1].at)',
    to: 'true',
    expect: 'the film scaffold refuses camera keys out of order, past the film, without a finite place or a zoom above 0, and a depth that is not finite',
  },
  {
    why: 'the scaffold keeps a contact at its design point once the camera moves, so the contact strip crops beside the touch',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '        return { ...c, x, y, design: [c.x, c.y], frame: f };',
    to: '        return { ...c, design: [c.x, c.y], frame: f };',
    expect: 'the film scaffold keeps its planned contacts on whole frames with their points, for a contact strip',
  },
  {
    why: "the scaffold moves a contact with the camera at depth 1 whatever its cause's depth",
    file: 'skills/artifex/film-scaffold.cjs',
    from: "        const depth = elements.find((e) => e.name === c.cause && shows(e, f, f))?.depth ?? 1;",
    to: '        const depth = 1;',
    expect: 'the film scaffold keeps its planned contacts on whole frames with their points, for a contact strip',
  },
  {
    why: 'the joiner reads every sample of a film on disk from the file\'s start, so the streamed film copies the wrong bytes',
    file: 'tools/stitch.js',
    from: 'r = fs.readSync(fd, b, got, n - got, at + got);',
    to: 'r = fs.readSync(fd, b, got, n - got, got);',
    expect: 'the command streams the joined film to disk, byte for byte the film joined in memory, and leaves nothing when it refuses',
  },
  {
    why: 'shots takes two shots with one name, so a cue table or a strip that finds a shot by name finds the first',
    file: 'core/time.js',
    from: '    if (out.some((shot) => shot.name === name)) throw',
    to: '    if (false) throw',
    expect: 'shots refuses two shots with one name, since a name finds its shot',
  },
  {
    why: 'a shot strip shows each shot\'s first frame twice instead of its middle, so a move inside the shot is never seen',
    file: 'tools/contact-sheet.js',
    from: '[s.start, Math.floor((s.start + s.end - 1) / 2), s.end - 1]',
    to: '[s.start, s.start, s.end - 1]',
    expect: 'contact sheet: --shots shows each shot of state.cues.shots at its first, middle and last frame, one row a shot',
  },
  {
    why: 'a shot strip wraps its cells in as many columns as fit, so a narrow strip no longer keeps one shot to a row',
    file: 'tools/contact-sheet.js',
    from: 'Math.min(contacts ? CONTACT_WINDOW.length : marks ? 3 : frames.length,',
    to: 'Math.min(frames.length,',
    expect: 'contact sheet: --shots shows each shot of state.cues.shots at its first, middle and last frame, one row a shot',
  },
  {
    why: 'a contact strip no longer starts each contact on a grid row of its own, so after a contact cut short by the film\'s end the next one begins mid-row',
    file: 'tools/contact-sheet.js',
    from: 'cell.column = ((cell.offset - CONTACT_WINDOW[0]) % columns) + 1;',
    to: 'cell.column = undefined;',
    expect: 'contact sheet: --contacts shows two frames before to three after each contact of a list in the built state, each contact starting a row',
  },
  {
    why: 'the browser check drops an MP4 film\'s flash count from its report, so nothing can require of it',
    file: 'tools/check-browser.js',
    from: 'convertMs: report.convertMs, flashes: report.flashes,',
    to: 'convertMs: report.convertMs,',
    expect: 'the page\'s film check carries the flash count the export reports, for an MP4 and a WebM film',
  },
  {
    why: 'the browser check drops a WebM film\'s flash count from its report',
    file: 'tools/check-browser.js',
    from: 'flashes: report.flashes, webm: btoa(binary),',
    to: 'webm: btoa(binary),',
    expect: 'the page\'s film check carries the flash count the export reports, for an MP4 and a WebM film',
  },
  {
    why: 'the browser check passes an example film whose flash count warns',
    file: 'tools/check-browser.js',
    from: "    if (flashNote(film.flashes)) throw new Error('browser: ' + name + ':' + flashNote(film.flashes));",
    to: '',
    expect: 'the browser check refuses an example film whose flash count warns, or that carries none',
  },
  {
    why: 'the browser check passes an example film the export never counted',
    file: 'tools/check-browser.js',
    from: "    if (!film.flashes) throw new Error('browser: ' + name + ': the film carries no flash count');",
    to: '',
    expect: 'the browser check refuses an example film whose flash count warns, or that carries none',
  },
  {
    why: 'the browser check takes the flash fixture without its general flashes',
    file: 'tools/check-browser.js',
    from: '!(flashes.general > WCAG.flashes) || ',
    to: '',
    expect: 'the browser check exports the flash fixture at its design size and requires a warning of more than three general and three red flashes',
  },
  {
    why: 'the browser check takes the flash fixture without its red flashes',
    file: 'tools/check-browser.js',
    from: '!(flashes.red > WCAG.flashes) || ',
    to: '',
    expect: 'the browser check exports the flash fixture at its design size and requires a warning of more than three general and three red flashes',
  },
  {
    why: 'the browser check takes the flash fixture\'s counts without the page\'s warning',
    file: 'tools/check-browser.js',
    from: ' || !flashNote(flashes)) {',
    to: ') {',
    expect: 'the browser check exports the flash fixture at its design size and requires a warning of more than three general and three red flashes',
  },
  {
    why: 'the browser check exports the flash fixture at the page\'s default scale, four times the pixels, for a count read at 300 pixels',
    file: 'tools/check-browser.js',
    from: 'external }, { scale: 1 }, options);',
    to: 'external }, {}, options);',
    expect: 'the browser check exports the flash fixture at its design size and requires a warning of more than three general and three red flashes',
  },
  {
    why: 'the check server does not serve the replayed file, so the page fetches nothing',
    file: 'tools/check-browser.js',
    from: "file && pathname === '/file'",
    to: "file && pathname === '/film'",
    expect: 'a replayed file reaches the page whole in one fetch from the loopback server, not in DevTools messages',
  },
  {
    why: 'a joined film is not handed to the page that replays its scenes',
    file: 'tools/replay.js',
    from: '* jobs.length, file: bytes };',
    to: '* jobs.length };',
    expect: 'replay compares every scene of a joined film of registered examples in one page, sent the film once',
  },
  {
    why: 'a strip frame\'s detail averages fixed 8-pixel blocks, so at another --scale the grid and the flags\' thresholds drift',
    file: 'tools/contact-sheet.js',
    from: 'const B = Math.max(1, Math.round(width / 80))',
    to: 'const B = 8',
    expect: 'contact sheet: a strip frame\'s detail and block grid are the same at any --scale, so the flags hold',
  },
  {
    why: 'a strip finds a flag\'s caption by frame number, so two cells of one frame put both flags under the first',
    file: 'tools/contact-sheet.js',
    from: 'captions[e.cell].appendChild(line);',
    to: 'captions[results.findIndex(function (r) { return r.frame === e.frame; })].appendChild(line);',
    expect: 'contact sheet: a strip writes each flag under its own cell, even when two cells show one frame',
  },
  {
    why: 'a strip reads each cell again for its detail after its metrics read it, about 3.5 ms more per cell in Edge',
    file: 'tools/contact-sheet.js',
    from: 'var d = frameDetail(image)',
    to: 'var d = frameDetail(c.getContext(\'2d\').getImageData(0, 0, c.width, c.height))',
    expect: 'contact sheet: a strip times each draw without reading its cell, which would move a GPU canvas to the CPU',
  },
  {
    why: 'a contact reflects a velocity that was already leaving the surface',
    file: 'core/sim.js',
    from: 'c.target = came >= 0 ? came : ',
    to: 'c.target = came >= 0 ? -e * came : ',
    expect: 'simulate: a contact reflects only a velocity that points into the surface',
  },
  {
    why: 'a step that carries a body across a wall is not caught, so a fast body passes through',
    file: 'core/sim.js',
    from: 'const crossed = (s0 > 0 && s1 <= 0) || (s0 < 0 && s1 >= 0);',
    to: 'const crossed = false;',
    expect: 'simulate: no tunnelling through a thin wall at the declared substeps, at any speed',
  },
  {
    why: 'a wall pushes a body straight up or down instead of along its normal, so nothing slides down a slope',
    file: 'core/sim.js',
    from: '    x[i] += nx * depth;\n    y[i] += ny * depth;',
    to: '    y[i] += (ny < 0 ? -1 : 1) * depth;',
    expect: 'simulate: a contact corrects along the normal, so a body slides down a smooth slope and rests on a rough one',
  },
  {
    why: 'a restitution above 1, which adds energy on every bounce, is taken',
    file: 'core/sim.js',
    from: "need('restitution', restitution, (v) => v >= 0 && v <= 1,",
    to: "need('restitution', restitution, (v) => v >= 0 && v <= 2,",
    expect: 'simulate refuses what it cannot solve, by name',
  },
  {
    why: 'an overlap the step starts in is put right inside the step, so the push out becomes speed',
    file: 'core/sim.js',
    from: '      collide(false);\n',
    to: '',
    expect: 'simulate: a body started inside a wall or another body is pushed out without gaining speed',
  },
  {
    why: 'a contact that keeps closing is logged on every step it lasts instead of once per impact',
    file: 'core/sim.js',
    from: '!before.has(key)',
    to: 'true',
    expect: 'simulate: contacts are logged once per impact, with the normal speed they closed at',
  },
  {
    why: 'two discs share an overlap equally whatever their masses',
    file: 'core/sim.js',
    from: '    const a = wi / (wi + wj);\n    x[i] += nx * depth * a;',
    to: '    const a = 0.5;\n    x[i] += nx * depth * a;',
    expect: 'simulate: a collision moves each of two discs by the share its mass leaves it, and keeps their momentum',
  },
  {
    why: 'contacts are solved in an order that changes from run to run',
    file: 'core/sim.js',
    from: 'for (let it = 0; it < iterations; it++) for (const c of touch.values()) bounce(c);',
    to: 'for (let it = 0; it < iterations; it++) for (const c of [...touch.values()].sort(() => Math.random() - 0.5)) bounce(c);',
    expect: 'simulate: the same input gives the same bytes, positions, velocities and contacts',
  },
  {
    why: 'contacts that share a body may hand it more motion than it brought into the step',
    file: 'core/sim.js',
    from: 'if (change > 0 && had + cross + change > cap) {',
    to: 'if (false) {',
    expect: 'simulate: energy never grows in piles of discs struck at once, even at half the default substeps',
  },
  {
    why: 'speed the push out of a deep overlap gave is kept, so a pile gains energy',
    file: 'core/sim.js',
    from: 'if (c.floor === null) c.floor = Math.min(0, c.target - vn);',
    to: 'c.floor = 0;',
    expect: 'simulate: energy never grows in piles of discs struck at once, even at half the default substeps',
  },
  {
    why: 'a body leaving the underside of a wall bounces back faster than gravity let it arrive',
    file: 'core/sim.js',
    from: '-e * Math.min(0, came + off)',
    to: '-e * came',
    expect: 'simulate: energy never grows in piles of discs struck at once, even at half the default substeps',
  },
  {
    why: 'a disc pushed into another cell keeps the neighbours of the cell it left, so it misses a disc it now touches',
    file: 'core/sim.js',
    from: 'if (refile(i)) { around(i, j); p = -1; }',
    to: 'refile(i);',
    expect: 'simulate: testing only near discs gives the same bytes as testing every pair',
  },
  {
    why: 'near discs are tested in the order they are filed, not in index order, so contacts resolve in another order',
    file: 'core/sim.js',
    from: 'for (; k > 0 && near[k - 1] > j; k--) near[k] = near[k - 1];',
    to: '',
    expect: 'simulate: testing only near discs gives the same bytes as testing every pair',
  },
  {
    why: 'walls are filed in a grid only when cut into few pieces, so the pegboard bench:sim times tests every wall',
    file: 'core/sim.js',
    from: 'if (pieces > 64 * M) walled = false;',
    to: 'if (pieces > 4 * M) walled = false;',
    expect: 'simulate: bench:sim\'s pegboard files its walls in a grid, and its wall-free piles do not',
  },
  {
    why: 'an ambience rate curve places its events uniformly, so rain cannot build or thin',
    file: 'core/sound.js',
    from: 'Math.min(n - lastN - 1, Math.floor(place(G(0)) * sr))',
    to: 'Math.floor(G(0) * (n - lastN))',
    expect: 'ambience grains follow a rate curve where one is given, and a plain rate keeps its seeded times',
  },
  {
    why: 'an ambience rate curve makes as many events as its first rate, not its area',
    file: 'core/sound.js',
    from: 'Math.round(curve ? density(many, length).total : many * length)',
    to: 'Math.round(curve ? many[0][1] * length : many * length)',
    expect: 'ambience grains follow a rate curve where one is given, and a plain rate keeps its seeded times',
  },
  {
    why: 'a wandering tinted bed keeps white noise\'s level compensation, so it grows louder as its colour falls',
    file: 'core/sound.js',
    from: 'keep = Math.sqrt((colour / hz) ** (1 - tilt));',
    to: 'keep = Math.sqrt(colour / hz);',
    expect: 'an ambience bed tinted pink falls 3 dB an octave from white and brown 6 dB, and white is the bed it always was',
  },
  {
    why: 'a voice holds its first pan point, so a crossing source never crosses the field',
    file: 'core/sound.js',
    from: 'for (const [t, p] of pan) place.pan.linearRampToValueAtTime(p, at + t);',
    to: 'for (const [t] of pan) place.pan.linearRampToValueAtTime(pan[0][1], at + t);',
    expect: 'voice pan points move it across the field, and tail.rise swells the tail before it falls',
  },
  {
    why: 'a tail.rise tail falls from its start, so a swell dies before it peaks',
    file: 'core/sound.js',
    from: 'const down = Math.exp((-FALL * Math.max(0, i - waitN)) / fallN);',
    to: 'const down = Math.exp((-FALL * i) / fallN);',
    expect: 'voice pan points move it across the field, and tail.rise swells the tail before it falls',
  },
  {
    why: 'the film scaffold ignores a declared lead, so a sound cannot rise before its cause enters',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'f + frame(lead))) {',
    to: 'f)) {',
    expect: 'the film scaffold lets a sound lead or trail its cause by the seconds it declares, and places a declared off-screen cause',
  },
  {
    why: 'the film scaffold counts a trail from the last frame its cause is on screen, one frame short',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'f - (trail > 0 ? frame(trail) + 1 : 0)',
    to: 'f - frame(trail)',
    expect: 'the film scaffold lets a sound lead or trail its cause by the seconds it declares, and places a declared off-screen cause',
  },
  {
    why: 'the film scaffold takes an off-screen cause that is on screen',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '          if (alive(c.cause, f, f)) throw',
    to: '          if (false) throw',
    expect: 'the film scaffold lets a sound lead or trail its cause by the seconds it declares, and places a declared off-screen cause',
  },
  {
    why: 'the film scaffold leaves an off-screen voice where the voice put it, not at its declared side',
    file: 'skills/artifex/film-scaffold.cjs',
    from: "pan: side === 'left' ? -0.8 : 0.8, distance",
    to: 'distance',
    expect: 'the film scaffold lets a sound lead or trail its cause by the seconds it declares, and places a declared off-screen cause',
  },
  {
    why: 'two keys at one time show the earlier value on the cut frame, so a pop lands a frame late',
    file: 'core/time.js',
    from: '    if (at[mid] <= x) lo = mid;',
    to: '    if (at[mid] < x) lo = mid;',
    expect: 'two keys at one time are a cut: the later value from that moment on',
  },
  {
    why: 'a key track moves at the next key\'s rate, so each spacing chart shapes the wrong move',
    file: 'core/time.js',
    from: 'rate[i]((x - at[i])',
    to: 'rate[i + 1]((x - at[i])',
    expect: 'a key track lands exactly on every key and moves at the rate the earlier key names',
  },
  {
    why: 'a key track reads past its last key, so the pose after the last key is not a number',
    file: 'core/time.js',
    from: '    if (i === last) return value[last];',
    to: '    if (false) return value[last];',
    expect: 'a key track lands exactly on every key and moves at the rate the earlier key names',
  },
  {
    why: 'a key track takes keys out of time order and moves backwards between them',
    file: 'core/time.js',
    from: '    if (i > 0 && x < at[i - 1]) throw',
    to: '    if (false && x < at[i - 1]) throw',
    expect: 'a key track keeps its own copy of the list and refuses bad keys by name',
  },
  {
    why: 'a gait places every contact as if each step lasted the first, so quicker steps fall on the wrong frames',
    file: 'core/time.js',
    from: '    contacts.push(contacts[i] + n);',
    to: '    contacts.push(start + lengths[0] * (i + 1));',
    expect: 'a gait counts strides from each contact and stands still outside its steps',
  },
  {
    why: 'a gait reads past its last contact, so a figure that has stopped walking is not a number',
    file: 'core/time.js',
    from: '    if (i >= steps) return steps;',
    to: '    if (i > steps) return steps;',
    expect: 'a gait counts strides from each contact and stands still outside its steps',
  },
  {
    why: 'a gait measures every step by the first one\'s length, so the picture leaves a quicker step before its footfall',
    file: 'core/time.js',
    from: '    return i + (x - contacts[i]) / (contacts[i + 1] - contacts[i]);',
    to: '    return i + (x - contacts[i]) / lengths[0];',
    expect: 'the picture and the footsteps read one gait: each stride begins on the frame of its footfall',
  },
  {
    why: 'a small disc no longer goes through the few large discs, so it passes through them',
    file: 'core/sim.js',
    from: 'for (const j of apart) {',
    to: 'for (const j of []) {',
    expect: 'simulate: testing only near discs gives the same bytes as testing every pair',
  },
  {
    why: 'a small disc no longer looks up the many large discs in their cells, so it passes through them',
    file: 'core/sim.js',
    from: '      big.walk(i, u0, u1, v0, v1, after);\n',
    to: '',
    expect: 'simulate: many large discs, in cells of their own or with the rest, give the same bytes as testing every pair',
  },
  {
    why: 'a small disc looks up the large cells within a large disc\'s radius alone, so it misses a large disc it touches',
    file: 'core/sim.js',
    from: 'const reach = (widest + widestLarge) * (1 + 2 ** -20);',
    to: 'const reach = widestLarge;',
    expect: 'simulate: many large discs, in cells of their own or with the rest, give the same bytes as testing every pair',
  },
  {
    why: 'a large disc looks up the small cells within its own radius alone, so it misses a small disc it touches',
    file: 'core/sim.js',
    from: 'Math.ceil((rad[i] + widest) / (2 * widest))',
    to: 'Math.ceil(rad[i] / (2 * widest))',
    expect: 'simulate: many large discs, in cells of their own or with the rest, give the same bytes as testing every pair',
  },
  {
    why: 'a large disc that looks up small cells is not looked up again when a push moves it to another, so it misses a disc it now touches',
    file: 'core/sim.js',
    from: '(span[i] > 0 && (Math.floor(x[i] / size) !== ox[i] || Math.floor(y[i] / size) !== oy[i]))',
    to: 'false',
    expect: 'simulate: many large discs, in cells of their own or with the rest, give the same bytes as testing every pair',
  },
  {
    why: 'a large disc that looks up small cells no longer looks up the other large discs, so they pass through each other',
    file: 'core/sim.js',
    from: '      big.walk(i, cx[i] - 1, cx[i] + 1, cy[i] - 1, cy[i] + 1, after);\n',
    to: '',
    expect: 'simulate: many large discs, in cells of their own or with the rest, give the same bytes as testing every pair',
  },
  {
    why: 'a disc filed with every other disc is not looked up again when a push moves it to another cell, so it misses a disc it now touches',
    file: 'core/sim.js',
    from: 'refile = together ? whole.move : refileApart;',
    to: 'refile = together ? () => false : refileApart;',
    expect: 'simulate: many large discs, in cells of their own or with the rest, give the same bytes as testing every pair',
  },
  {
    why: 'a pass with a disc beyond 2^22 cells tests no pair at all instead of every pair',
    file: 'core/sim.js',
    from: 'if (discs.some(far)) return false;',
    to: 'if (discs.some(far)) return true;',
    expect: 'simulate: discs beyond 2^22 cells from the origin still meet, by testing every pair',
  },
  {
    why: 'a particle pushed out of one wall keeps the walls near where it was, so it misses a wall it now touches',
    file: 'core/sim.js',
    from: '        m = wallsNear(i, k);\n',
    to: '        continue;\n',
    expect: 'simulate: testing only near walls gives the same bytes as testing every wall',
  },
  {
    why: 'wall contacts are met particle by particle, not wall by wall, so they resolve in another order',
    file: 'core/sim.js',
    from: '    order.sort(byWall);\n',
    to: '',
    expect: 'simulate: testing only near walls gives the same bytes as testing every wall',
  },
  {
    why: 'a particle looks up only the cells its centre crosses, so a disc misses a wall within its radius',
    file: 'core/sim.js',
    from: 'const r = rad[i] + pad;',
    to: 'const r = pad;',
    expect: 'simulate: testing only near walls gives the same bytes as testing every wall',
  },
  {
    why: 'the film scaffold pans an off-screen voice hard to its side, so a mono fold loses 3 dB',
    file: 'skills/artifex/film-scaffold.cjs',
    from: "pan: side === 'left' ? -0.8 : 0.8, distance",
    to: "pan: side === 'left' ? -1 : 1, distance",
    expect: 'the film scaffold pans an off-screen voice to its side and keeps it within 2 dB of the centre when folded to mono',
  },
  {
    why: "the film scaffold's send keeps a panned voice's two channels, so the room hears one side of it",
    file: 'skills/artifex/film-scaffold.cjs',
    from: "        Object.assign(send, { channelCount: 1, channelCountMode: 'explicit' });\n",
    to: '',
    expect: "the film scaffold's room reaches both sides of a panned voice, as loud as a centred voice's",
  },
  {
    why: "the film scaffold sends every sound to ROOM, never to its place's room",
    file: 'skills/artifex/film-scaffold.cjs',
    from: '      (c.role ? musicSends : sends).get(c.room).push(send);',
    to: '      (c.role ? musicSends : sends).get(null).push(send);',
    expect: 'the film scaffold plays each sound in the room of its place, and in ROOM outside every place',
  },
  {
    why: "the film scaffold plays a place's own sound in whatever place is on screen, not in its own room",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'Object.hasOwn(ROOMS, cause) ? cause : elements',
    to: 'false ? cause : elements',
    expect: 'the film scaffold plays each sound in the room of its place, and in ROOM outside every place',
  },
  {
    why: 'the film scaffold picks the first of two overlapping places, not the latest to enter',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '.reduce((a, e) => (a && a.enter > e.enter ? a : e), null)',
    to: '.reduce((a, e) => a || e, null)',
    expect: 'the film scaffold plays each sound in the room of its place, and in ROOM outside every place',
  },
  {
    why: 'the film scaffold takes music as loud as a caused voice as held under it',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'level > 0 && level <= music.level(',
    to: 'level > 0 && level < music.level(',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold judges a swell under music already playing by its near-silent first frames, so it warns of a swell rising out of a quiet bed',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const under = m.frame <= c.frame;',
    to: 'const under = false;',
    expect: 'the film scaffold judges a swelling tail from its peak under music already playing',
  },
  {
    why: 'the film scaffold reads a rise frame its gain keys silence at the swell\'s peak, so it warns of a voice not yet heard',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 's < event.swell && event.level(s) > 0 ?',
    to: 's < event.swell ?',
    expect: 'the film scaffold judges a swelling tail from its peak under music already playing',
  },
  {
    why: 'the film scaffold judges a voice against the music at its peak, though the music has fallen far below it by then',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'music.level(Math.max(0, f - m.frame) / HZ)',
    to: 'music.level(0)',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold takes music as louder than a caused voice started at velocity 0, which is silent',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (!(event?.peak > 0 && m.frame',
    to: 'if (!(event && m.frame',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold judges a voice against the music only as it starts, so an ambience rising over a held voice never warns',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'f <= c.frame + event.held * HZ; f++',
    to: 'f <= c.frame; f++',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold reads an ambience bed's RMS on each side as a sine's peak, 3 dB under a voice of the same stereo power",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'let peak = level * 2 * 10',
    to: 'let peak = level * Math.SQRT2 * 10',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold reads an ambience bed at its RMS, though core wanders each side's level up to 10 ** (0.3 * drift) after normalising it",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'let peak = level * 2 * 10 ** (0.3 * drift);',
    to: 'let peak = level * 2;',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold reads an ambience at full level through its fades, so a voice early in its fade-in warns against a bed far below it',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'peak * (edge(s) >= 1 ? 1 :',
    to: 'peak * (true ? 1 :',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold reads an ambience's fades as 1 s whatever its `fade`, so a voice after a short fade-in misses a bed already at full level",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'Math.min(s, length - s) / fade;',
    to: 'Math.min(s, length - s) / 1;',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold reads an ambience's fades as a linear ramp, above core's raised cosine early in the fade-in",
    file: 'skills/artifex/film-scaffold.cjs',
    from: '0.5 - 0.5 * Math.cos(Math.PI * edge(s))',
    to: 'edge(s)',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold hears a grain at grains.level, not at the peak its rise and fall let it reach',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'peak = Math.max(peak, env * Math.min(1, i / 48) * Math.abs(Math.sin(phase)));',
    to: 'peak = Math.max(peak, top);',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold hears a low grain at its envelope's peak, though its sine starting at 0 has not reached its crest by then",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'env * Math.min(1, i / 48) * Math.abs(Math.sin(phase))',
    to: 'env * Math.min(1, i / 48)',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold drops a grain's negative crests, which core plays as loud as its positive ones",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'Math.abs(Math.sin(phase))',
    to: 'Math.sin(phase)',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold reads grains only at the band's top pitch, though a lower one's crest can meet the envelope's peak",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'o >= 0; o--',
    to: 'o >= Math.ceil(96 * span); o--',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold holds a music voice's tail through its attack, though core falls it from the voice's start",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'fall(s - swell, tail.length ?? 1.5)),',
    to: 'fall(s - swell - attack, tail.length ?? 1.5)),',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: "the film scaffold reads a tail.rise tail as falling from the voice's start, so music over the swell goes unjudged",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const swell = tail.level ? tail.rise ?? 0 : 0;',
    to: 'const swell = 0;',
    expect: 'the film scaffold judges music over a swelling tail through its tail.rise',
  },
  {
    why: "the film scaffold's room send holds a moving voice's first pan point, so the room loses it as it crosses",
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'for (const [t, p] of pan) send.gain.linearRampToValueAtTime(undo(p), at + t);',
    to: 'for (const [t] of pan) send.gain.linearRampToValueAtTime(undo(pan[0][1]), at + t);',
    expect: "the film scaffold's room follows a voice along its pan points, and a centred or fixed pan keeps its send",
  },
  {
    why: 'the film scaffold refuses a sound row with role: null, which is no role',
    file: 'skills/artifex/film-scaffold.cjs',
    from: "if (c.role != null && c.role !== 'music'",
    to: "if (c.role !== undefined && c.role !== 'music'",
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold lets music come forward on any beat, marked forward or not',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'const forward = beats.some((b) => b.forward && b.frame === m.frame)',
    to: 'const forward = beats.some((b) => b.frame === m.frame)',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold lets music that starts on a beat marked forward stay loud over every voice after it',
    file: 'skills/artifex/film-scaffold.cjs',
    from: '!(forward && Math.abs(c.frame - m.frame) < settle)',
    to: '!forward',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold lets a beat carry two stings',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (stings.length > 1)',
    to: 'if (stings.length > 2)',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold takes a sound row with a misspelt role, which no music check then reads',
    file: 'skills/artifex/film-scaffold.cjs',
    from: "if (c.role != null && c.role !== 'music' && c.role !== 'sting') throw",
    to: 'if (false) throw',
    expect: 'the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting',
  },
  {
    why: 'the film scaffold takes a foot with no HORIZON, so a standing row is sized from no eye level',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (HORIZON == null) throw',
    to: 'if (false) throw',
    expect: 'the film scaffold sizes a standing element from its foot contact below the horizon, and refuses feet on or above it',
  },
  {
    why: 'the film scaffold takes a HORIZON that is set but is not a finite number, such as a string, and sizes rows from it',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (HORIZON != null && !Number.isFinite(HORIZON)) throw',
    to: 'if (false) throw',
    expect: 'the film scaffold refuses a HORIZON that is set but not a finite number whatever the rows',
  },
  {
    why: 'the film scaffold takes a foot that is not a finite design y, so the row is sized from NaN',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (!Number.isFinite(e.foot)) throw',
    to: 'if (false) throw',
    expect: 'the film scaffold sizes a standing element from its foot contact below the horizon, and refuses feet on or above it',
  },
  {
    why: 'the film scaffold takes a tall that is zero or not a number, so the row is sized to nothing or NaN',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (e.tall !== undefined && !(Number.isFinite(e.tall) && e.tall > 0)) throw',
    to: 'if (false) throw',
    expect: 'the film scaffold sizes a standing element from its foot contact below the horizon, and refuses feet on or above it',
  },
  {
    why: 'the film scaffold lets feet stand on or above the horizon, so the row floats',
    file: 'skills/artifex/film-scaffold.cjs',
    from: 'if (!(e.foot > HORIZON)) throw',
    to: 'if (false) throw',
    expect: 'the film scaffold sizes a standing element from its foot contact below the horizon, and refuses feet on or above it',
  },
  {
    why: 'a rope link pushes its particles apart like any link, so a chain dropped on its end stands',
    file: 'core/sim.js',
    from: 'if (d === 0 || (rope[j] && d <= len[j])) continue;',
    to: 'if (d === 0) continue;',
    expect: 'simulate: a chain of rope links dropped on its end folds, where plain links stand',
  },
  {
    why: 'a rope link overshoots its length each relaxation, so a chain of them gains energy',
    file: 'core/sim.js',
    from: 'const c = (stiff[j] * (d - len[j]))',
    to: 'const c = ((rope[j] ? 2.5 : stiff[j]) * (d - len[j]))',
    expect: 'simulate: energy never grows without input with rope links either',
  },
  {
    why: 'the solver runs one more pass of reflections a step, so a run the examples make moves with no pin updated',
    file: 'core/sim.js',
    from: 'for (let it = 0; it < iterations; it++) for (const c of touch.values()) bounce(c);',
    to: 'for (let it = 0; it <= iterations; it++) for (const c of touch.values()) bounce(c);',
    expect: 'simulate: the runs the examples make, and the busy system, keep their pinned digests',
  },
  {
    why: 'a body that begins touching is never logged, so its impacts are silent',
    file: 'core/sim.js',
    from: '    log.push(Object.freeze({\n',
    to: '    [].push(Object.freeze({\n',
    expect: 'simulate: a body logs one contact per impact, naming the body and what it struck',
  },
  {
    why: 'a body\'s pose keeps no angle, so a toppled box is drawn upright',
    file: 'core/sim.js',
    from: 'poses[o + 2] = it.getAngle();',
    to: 'poses[o + 2] = 0;',
    expect: 'simulate: a stack of boxes struck at the top turns, topples onto its faces and rests, never sinking into the floor',
  },
  {
    why: 'a touch planck reports as a step opens is stamped with that step, so its sound plays a frame late',
    file: 'core/sim.js',
    from: 'frame: opening ? was[0] : f, seconds: opening ? was[1] : sec,',
    to: 'frame: f, seconds: sec,',
    expect: 'simulate: a contact between two bodies names the first frame whose poses touch',
  },
  {
    why: 'planck keeps its cap of two units a step, so a fast body is silently slowed',
    file: 'core/sim.js',
    from: '  planck.Settings.maxTranslation = Infinity;\n',
    to: '\n',
    expect: 'simulate: a fast body does not pass through a fixed wall, at any substeps',
  },
  {
    why: 'a body still touching never logs again, so a box that pivots on a corner and slams its face down is silent',
    file: 'core/sim.js',
    from: 'if (before && !before.has(ids[i].id.key)) at.push(i);',
    to: 'if (false) at.push(i);',
    expect: 'simulate: a body that lands again while still touching logs that impact once',
  },
  {
    why: 'every dynamic body is swept against the others, so a stack left alone tips over',
    file: 'core/sim.js',
    from: 'it.setBullet(it.isDynamic() && (',
    to: 'it.setBullet(it.isDynamic() || (',
    expect: 'simulate: a stack of boxes left alone stands',
  },
  {
    why: 'no body is swept against the others, so a fast body passes through one',
    file: 'core/sim.js',
    from: 'it.setBullet(it.isDynamic() && (',
    to: 'it.setBullet(false && (',
    expect: 'simulate: a fast body does not pass through another body',
  },
  {
    why: 'a quantile takes the floor of its rank, so a fractional rank reads the pixel below',
    file: 'tools/contact-sheet.js',
    from: 'Math.max(1, Math.ceil(p * n))',
    to: 'Math.max(1, Math.floor(p * n))',
    expect: 'contact sheet: cellViews takes chroma p50 and p95 by nearest rank, rounding a fractional rank up',
  },
  {
    why: 'a quantile rounds its rank to the nearest, so a fraction below .5 reads the pixel below',
    file: 'tools/contact-sheet.js',
    from: 'Math.max(1, Math.ceil(p * n))',
    to: 'Math.max(1, Math.round(p * n))',
    expect: 'contact sheet: cellViews takes chroma p50 and p95 by nearest rank, rounding a fractional rank up',
  },
  {
    why: 'a quantile reads one rank above the nearest rank',
    file: 'tools/contact-sheet.js',
    from: 'Math.max(1, Math.ceil(p * n))',
    to: 'Math.max(1, Math.ceil(p * n) + 1)',
    expect: 'contact sheet: every time-strip cell reports the mean, min, max, range, p5 and p95 of its OKLCh lightness, with or without views',
  },
  {
    why: 'a quantile reads one rank below the nearest rank',
    file: 'tools/contact-sheet.js',
    from: 'Math.max(1, Math.ceil(p * n))',
    to: 'Math.max(1, Math.ceil(p * n) - 1)',
    expect: 'contact sheet: cellViews takes chroma p50 and p95 by nearest rank, rounding a fractional rank up',
  },
  {
    why: 'a session keeps the row a step pushed, not a copy, so a step that edits it later changes what was heard',
    file: 'core/play.js',
    from: '      s.sounds.push(JSON.parse(JSON.stringify(rows[i])));',
    to: '      s.sounds.push(rows[i]);',
    expect: 'a session keeps a copy of each sound cue its steps push, in order, and refuses a cue by shape',
  },
  {
    why: 'a sound cue may name a tick already played, which no export can render where it was heard',
    file: 'core/play.js',
    from: '  if (!(Number.isInteger(row.tick) && row.tick >= tick && row.tick <= MAX_TICKS)) return',
    to: '  if (false) return',
    expect: 'a session keeps a copy of each sound cue its steps push, in order, and refuses a cue by shape',
  },
  {
    why: 'a session film renders its cues dry only, so every wet cue loses its room',
    file: 'core/play.js',
    from: "  if (sends.length) { const r = room(ctx, R, 'room'); sumInto(ctx, sends, r); parts.push(r); }",
    to: '',
    expect: 'a session film renders its cues offline, each at its tick, dry and through one room; a silent session makes a silent film',
  },
  {
    why: 'a session film is silent whatever its steps pushed',
    file: 'core/play.js',
    from: '    ...(cues.length && { sound:',
    to: '    ...(false && { sound:',
    expect: 'a session film renders its cues offline, each at its tick, dry and through one room; a silent session makes a silent film',
  },
  {
    why: 'a session film forgets the reduced motion it was played with, so its export moves where the live page held still',
    file: 'core/play.js',
    from: '      p.draw(surface, s.state, s.tick / hz, clockAt(p, s.tick / hz, { reducedMotion }));',
    to: '      p.draw(surface, s.state, s.tick / hz, clockAt(p, s.tick / hz));',
    expect: 'reduced motion is the player\'s: draw sees it in the clock, the saved session keeps it, and its film draws with it',
  },
  {
    why: 'save session drops the reduced-motion flag',
    file: 'core/play.js',
    from: ', ...(s.reducedMotion && { reducedMotion: true }) }),',
    to: ' }),',
    expect: 'reduced motion is the player\'s: draw sees it in the clock, the saved session keeps it, and its film draws with it',
  },
  {
    why: 'the page never plays a session\'s cues live',
    file: 'tools/build-page.js',
    from: '  playCues(s);\n  if (!drawPlay(now)) return;',
    to: '  if (!drawPlay(now)) return;',
    expect: 'the page plays each cue live once, after the first gesture made its context, and plays the session under reduced motion when asked',
  },
  {
    why: 'the browser check\'s deadline covers the whole page again, so its examples and films together time out on a loaded machine',
    file: 'tools/check-browser.js',
    from: 'set: (next) => { phase = next; clearTimeout(timer); if (!signal.aborted) timer = setTimeout(expire, timeoutMs); },',
    to: 'set: (next) => { phase = next; },',
    expect: 'with phaseDeadline each phase gets the whole deadline, so a long run of quick phases passes and one slow phase fails by name',
  },
  {
    why: 'seeds --session draws the piece itself instead of the session\'s film',
    file: 'tools/contact-sheet.js',
    from: '  if (session) return session.film;\n',
    to: '',
    expect: 'contact sheet: --session draws a saved session as a time strip at its own seed, named after the file, and refuses what a session fixes',
  },

];

// Copy only what `node --test tests/*.test.js` reads: the tests, their modules
// under `core/`, `examples/` and `tools/`, the styles under `skills/`, and
// `package.json`. The site's own tests run outside this suite, and
// `tools/check-site.js` loads `site/` only when it walks the site. Keeping an
// explicit allowlist prevents unrelated workspace data from increasing every copy.
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
// its own inside a copy: <TEMP>/<run>/<copy>-t/<fixture>/.../<run>/control-t/...
// A copy's suite temp sits beside the copy, not in it: a fixture inside the
// copy would lie inside the library and be treated as part of it.
const RUN_PREFIX = 'artifex-neg-';
const SUITE_TEMP = '-t';

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
  const deadline = performance.now() + limitMs;
  for (;;) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || performance.now() >= deadline) throw error;
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

const SUITE = ['tests/*.test.js'];
// The control's second reporter lists each result's file. Node imports a
// reporter, so an absolute path must be a URL on Windows.
const REPORTER = pathToFileURL(path.join(__dirname, 'negative-reporter.js')).href;

/** Keep process evidence even when no test runner starts or no TAP is emitted. */
async function runSuite(dir, execute = executeSuite, timeout, files = SUITE, reporters = []) {
  const timeoutMs = suiteDeadline(timeout);
  let result;
  // A runner invoked from a regression test must start an independent suite.
  // Inheriting child-v8 makes Node skip the requested files with exit 0.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // A runner copy gives its suite a temporary directory beside itself, so
  // removing the copy also removes what a killed suite never cleaned up.
  const temp = dir + SUITE_TEMP;
  if (fs.existsSync(temp)) env.TEMP = env.TMP = env.TMPDIR = temp;
  try {
    result = await execute(process.execPath, ['--test', '--test-reporter=tap', ...reporters, ...files], {
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
  return { ...result, status, signal, error, stdout, stderr, timeoutMs, timedOut: error?.code === 'ETIMEDOUT', files, ...report, failure };
}

/**
 * The test file of each title in the control's listing, or null for a title
 * reported more than once. A mutation whose title has no file runs the whole
 * suite, where a repeated title stays an infrastructure result.
 */
function testFiles(dir, listing) {
  const files = new Map();
  for (const line of fs.readFileSync(listing, 'utf8').split('\n').filter(Boolean)) {
    const [file, name] = JSON.parse(line);
    files.set(name, files.has(name) || typeof file !== 'string' ? null : path.relative(dir, file).replace(/\\/g, '/'));
  }
  return files;
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
  const { status, signal, error, terminationError, failure, timeoutMs, timedOut, pid, files } = result;
  fs.writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify({
    status, signal, failure, timeoutMs, timedOut, pid, files,
    error: error && { code: error.code, message: error.message }, terminationError: terminationError?.message,
  }, null, 2)}\n`);
  return dir;
}

/**
 * Judge one mutated copy on `files`, and on the whole suite when they are
 * narrower and miss, so an escape or a catch by another test reads as a whole
 * run reports it. An infrastructure result keeps its evidence and runs the same
 * files once more for the report only: the verdict stays infrastructure
 * whatever the second attempt shows, so load can never turn a failure into a pass.
 */
async function judgeMutation(dir, m, evidence, timeoutMs, execute = executeSuite, files = SUITE) {
  let result = await runSuite(dir, execute, timeoutMs, files);
  let verdict = mutationVerdict(result, m.expect);
  if (files !== SUITE && (verdict === 'escaped' || verdict === 'misnamed')) {
    files = SUITE;
    result = await runSuite(dir, execute, timeoutMs);
    verdict = mutationVerdict(result, m.expect);
  }
  if (verdict === 'caught') return { verdict, text: `ok              ${m.why}` };
  if (verdict === 'escaped') return { verdict, text: `ESCAPED         ${m.why}\n                nothing failed; no check covers this` };
  if (verdict === 'misnamed') {
    return { verdict, text: `MISNAMED        ${m.why}\n                expected: ${m.expect}\n                failed:\n${failedDetail(result, '                  ')}` };
  }
  const kept = keepEvidence(evidence, result);
  const again = await runSuite(dir, execute, timeoutMs, files);
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
  const refuse = (cause) => new Error('negative: ' + cause + '\n' + USAGE);
  for (let i = 0; i < args.length; i += 2) {
    const kind = { '--file': files, '--expect': expects, '--shard': shards }[args[i]];
    if (!kind) throw refuse('unknown option ' + args[i]);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw refuse(args[i] + ' needs a value');
    kind.push(args[i + 1]);
  }
  const shard = shards.length && /^([1-9]\d*)\/([1-9]\d*)$/.exec(shards[0]);
  if (shards.length > 1) throw refuse('give --shard only once');
  if (shards.length && !(shard && +shard[1] <= +shard[2])) throw refuse('--shard needs k/n, whole numbers with 1 <= k <= n, got ' + shards[0]);
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
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return 0; }
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
    fs.mkdirSync(control + SUITE_TEMP);
    const per = (bytes / 1048576).toFixed(2);
    // Report copy volume because the same source is copied for every mutation.
    console.log(`copy     ${per} MB per mutation, ${((bytes * (chosen.length + 1)) / 1048576).toFixed(0)} MB in all`);
    // A filtered run still checks every patch text, so a stale mutation elsewhere fails loudly.
    for (const m of mutations) {
      if (chosen.includes(m)) continue;
      const problem = patchProblem(fs.readFileSync(path.join(root, m.file), 'utf8'), m);
      if (problem) { console.log(problem); invalid++; }
    }
    // Beside its TAP, the control lists each result's file for choosing the mutations' files.
    const listing = path.join(tmp, 'control.jsonl');
    const already = await runSuite(control, undefined, timeoutMs, undefined,
      ['--test-reporter-destination=stdout', `--test-reporter=${REPORTER}`, `--test-reporter-destination=${listing}`]);
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
    const fileOf = testFiles(control, listing);
    // A mutation's file runs alone, so it must pass alone: one that passes only
    // beside the others would make every mutation aimed at it look caught.
    for (const file of new Set(chosen.map((m) => fileOf.get(m.expect)).filter(Boolean))) {
      const alone = await runSuite(control, undefined, timeoutMs, [file]);
      if (!alone.failure && !alone.failed.length) continue;
      // Why, so a file that timed out under load reads differently from one that needs another file.
      console.log(`alone    ${file} does not pass on its own, so its mutations run the whole suite\n${alone.failure
        ? `         ${infrastructureDetail(alone)}` : failedDetail(alone, '         ')}`);
      for (const [name, own] of fileOf) if (own === file) fileOf.set(name, null);
    }
    const narrow = `; ${chosen.filter((m) => fileOf.get(m.expect)).length} run only their expected test's file`;
    console.log(filter
      ? `control  ${chosen.length} of ${mutations.length} mutations selected by ${filter}, suite green before any of them${narrow}\n`
      : `control  ${mutations.length} mutations, suite green before any of them${narrow}\n`);

    // Indices stay those of the whole list, so evidence paths match a full run's.
    for (const [i, m] of mutations.entries()) {
      if (!chosen.includes(m)) continue;
      const dir = path.join(tmp, `m${i}`);
      copyDir(root, dir, true);
      fs.mkdirSync(dir + SUITE_TEMP);
      const file = path.join(dir, m.file);
      const src = fs.readFileSync(file, 'utf8');

      const problem = patchProblem(src, m);
      if (problem) {
        console.log(problem);
        invalid++;
      } else {
        fs.writeFileSync(file, src.replace(m.from, m.to));
        const own = fileOf.get(m.expect);
        const { verdict, text } = await judgeMutation(dir, m, path.join(evidence, `m${i}`), timeoutMs, undefined, own ? [own] : undefined);
        console.log(text);
        if (verdict === 'infra') infrastructure++;
        else if (verdict === 'escaped') escaped++;
        else if (verdict === 'misnamed') misnamed++;
        else passed++;
      }
      // Hold at most one mutated copy: its verdict is printed and any evidence
      // is kept outside it. A copy that cannot be removed is reported.
      try { await removeCopy(dir); await removeCopy(dir + SUITE_TEMP); } catch (error) {
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
  MUTATIONS, patchProblem,
};
