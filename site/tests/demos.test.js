'use strict';

// The showcase site's style demos in site/demos: the songbird staged in one
// scene per style, drawn with the marks of skills/artifex/styles. These check
// the demos' own promises: seeded choices, lined-up views, readable words.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { renderVector } = require('../../core/render.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DEMOS = path.join(ROOT, 'site', 'demos');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('the cad sheet rendered as SVG differs between two seeds', () => {
  // The printed seed differs on its own; the drawing's seeded choices are tested below.
  const cad = { ...require(path.join(DEMOS, 'cad.js')), outputs: ['raster', 'vector'] };
  const drawing = (seed) => renderVector(cad, { seed }).svg.replace(/<metadata id="artifex-manifest">[^<]*<\/metadata>/, '');
  assert.ok(drawing(2026) !== drawing(4294967295), 'cad draws the same sheet at seeds 2026 and 4294967295');
});

test('cad shows all four grounds in any four consecutive seeds, and keeps seed 1 and 2026 on theirs', () => {
  const { draw } = require(path.join(DEMOS, 'cad.js'));
  const ground = (seed) => {
    let first;
    const g = new Proxy({}, { get: () => () => {}, set: (o, k, v) => { if (k === 'fillStyle' && first === undefined) first = v; return true; } });
    draw(g, { seed, t: 0 });
    return first;
  };
  const grounds = Array.from({ length: 12 }, (_, i) => ground(i + 1));
  for (let i = 0; i + 4 <= grounds.length; i++) assert.equal(new Set(grounds.slice(i, i + 4)).size, 4, `seeds ${i + 1}-${i + 4}: ${grounds.slice(i, i + 4)}`);
  assert.equal(ground(4294967295), ground(3), 'the top seed takes its turn like any other');
  assert.deepEqual([ground(1), ground(2026)], ['#163a24', '#2b2b2b'], 'the default sheet and the site\'s sheet keep their grounds');
});

// Records every call and property set a style makes through a stand-in context,
// with text left out so a printed seed cannot tell two seeds apart, as a digest.
// Only the random names in `chosen` follow the seed; every other name, such as
// pen wobble, grain or texel noise, is held at one seed, so the digest changes
// only through what the seed chooses.
function drawnDigest(module, seed, chosen) {
  const font = require('../../core/stroke-font.js');
  const rand = require('../../core/rand.js');
  // The demo and the style's marks both load afresh, so both read the stand-in rng.
  const files = [path.join(DEMOS, module), path.join(ROOT, 'skills', 'artifex', 'styles', module)];
  const { rng } = rand;
  rand.rng = (s) => { const live = rng(s); const held = rng(7); return (name, ...rest) => (chosen.includes(name) ? live : held)(name, ...rest); };
  for (const file of files) delete require.cache[file];
  let style;
  try { style = require(files[0]); } finally { rand.rng = rng; for (const file of files) delete require.cache[file]; }
  const hash = crypto.createHash('sha256');
  const note = (...parts) => hash.update(JSON.stringify(parts, (k, v) => (ArrayBuffer.isView(v) ? sha(Buffer.from(v.buffer)) : v)) + '\n');
  const gradient = () => ({ addColorStop: (...a) => note('stop', ...a) });
  const g = new Proxy({}, {
    get: (o, k) => {
      if (k in o) return o[k];
      if (k === 'canvas') return undefined;
      if (k === 'getTransform') return () => ({ a: 0.25, b: 0, c: 0, d: 0.25, e: 0, f: 0 });
      if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { note(k, ...a); return gradient(); };
      return (...a) => note(k, ...a);
    },
    set: (o, k, v) => { note('set', k, typeof v === 'object' ? 'gradient' : v); return true; },
  });
  const text = font.text;
  font.text = () => {};
  try { style.draw(g, { seed, t: 0.5 }); } finally { font.text = text; }
  return hash.digest('hex');
}

test('each style whose seed picks pose, palette or composition draws differently at two seeds', () => {
  // The names each style draws its choices from; noise alone never counts.
  const chosen = {
    'render-3d.js': ['look', 'pose'], 'cad.js': ['look', 'pose'], 'voxel.js': ['look', 'crown', 'bird', 'cloud'],
    'doodle.js': ['look', 'star'], 'pixel-art.js': ['look', 'moon'], 'kandinsky.js': ['look', 'place'],
  };
  const same = Object.entries(chosen).filter(([module, names]) => drawnDigest(module, 1, names) === drawnDigest(module, 2, names)).map(([module]) => module);
  assert.deepEqual(same, [], 'these styles draw the same picture at seeds 1 and 2, their noise and printed text aside');
});

/** Where a closed polygon crosses the vertical line x: [top, bottom]. */
function spanAt(poly, x) {
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  return [Math.min(...ys), Math.max(...ys)];
}

// Draws cad through a stand-in context that records every subpath in sheet
// units (cad translates only for text) and every text with its translation.
function cadSheet(seed) {
  const font = require('../../core/stroke-font.js');
  const polys = []; const texts = [];
  let st = { x: 0, y: 0 }; const stack = [];
  let cur = null;
  const g = new Proxy({
    save() { stack.push({ ...st }); }, restore() { st = stack.pop(); },
    translate(x, y) { st.x += x; st.y += y; },
    moveTo(x, y) { cur = [[x, y]]; polys.push(cur); }, lineTo(x, y) { cur.push([x, y]); },
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
  const text = font.text;
  font.text = (ctx, str, x, y, size) => texts.push({ str, x: st.x + x, y: st.y + y, w: font.width(str, size), size });
  try { require(path.join(DEMOS, 'cad.js')).draw(g, { seed, t: 0 }); } finally { font.text = text; }
  return { polys, texts };
}

test('cad keeps its views lined up and its cut labels clear of the legs at seeds 1-500', () => {
  const { bird } = require('../demos/subject.js');
  // The front view maps unit (x, y) to (300 + 200 x, 510 + 200 y); the left leg is drawn 0.014 wider each side.
  const [[la, lb]] = bird(0, 0, 1).legs;
  const legLeft = (y) => 300 + 200 * (la[0] + ((y - 510) / 200 - la[1]) * ((lb[0] - la[0]) / (lb[1] - la[1])) - 0.014);
  const footLineX = 300 + 200 * (lb[0] - 0.07);
  for (let seed = 1; seed <= 500; seed++) {
    const { polys, texts } = cadSheet(seed);
    // The top view's right wing is the 32-point outline below the top view's centre line, y 205.
    const wingR = polys.find((p) => p.length === 32 && p.every(([, y]) => y > 205));
    // The section is the 72-point ellipse about x 740 that starts, at angle 0, below y 500; the right shell is the 34-point hull at x >= 740.
    const section = polys.find((p) => p.length === 72 && p[0][1] > 500 && Math.abs(Math.max(...p.map(([x]) => x)) + Math.min(...p.map(([x]) => x)) - 1480) < 1e-6);
    const shell = polys.find((p) => p.length === 34 && p.every(([x]) => x >= 740 - 1e-9));
    assert.ok(wingR && section && shell, `seed ${seed}: the wing, the section and its right shell are drawn`);
    // The cut's two A labels are 14 high; the zone letters and the revision are smaller.
    const labels = texts.filter((t) => t.str === 'A' && t.size === 14).sort((a, b) => a.y - b.y);
    assert.equal(labels.length, 2, `seed ${seed}: two A labels`);
    const cutX = labels[1].x + labels[1].w / 2 - 14; const cutBot = labels[1].y + labels[1].size / 2 - 16;
    // The section is as wide as the top outline at the cut, and its shells reach the wing's outer edge there, beyond the body.
    const rz = (Math.max(...section.map(([x]) => x)) - 740) / 200;
    const wingOut = (spanAt(wingR, cutX)[1] - 205) / 200;
    const shellOut = (Math.max(...shell.map(([x]) => x)) - 740) / 200;
    assert.ok(Math.abs(shellOut - wingOut) < 1e-6, `seed ${seed}: the shell reaches ${shellOut.toFixed(4)} but the wing's outer edge at the cut is ${wingOut.toFixed(4)}`);
    assert.ok(shellOut > rz + 0.012, `seed ${seed}: the shell at ${shellOut.toFixed(4)} does not bulge past the body's flank at ${rz.toFixed(4)}`);
    // The lower A, with its 1.4 stroke, ends left of the foot line's start, and the cut arrow's tip left of the leg.
    const labelRight = labels[1].x + labels[1].w + 0.7;
    assert.ok(labelRight <= footLineX - 2, `seed ${seed}: the lower A ends at x ${labelRight.toFixed(1)}, within 2 px of the foot line at ${footLineX}`);
    assert.ok(cutX + 30 <= legLeft(cutBot) - 5, `seed ${seed}: the cut arrow's tip at x ${(cutX + 30).toFixed(1)} is within 5 px of the leg at ${legLeft(cutBot).toFixed(1)}`);
  }
});

test('voxel joins every island block to the island and stands each crown block at z 6 or above on a block, at seeds 1-500', () => {
  const { rng } = require('../../core/rand.js');
  const { island } = require(path.join(DEMOS, 'voxel.js'));
  for (let seed = 1; seed <= 500; seed++) {
    const { boxes, cell } = island(rng(seed));
    assert.equal(boxes.length, cell.size, `seed ${seed}: one cell per block`);
    const seen = new Set(['2,1,0']); const queue = ['2,1,0'];
    while (queue.length) {
      const [x, y, z] = queue.pop().split(',').map(Number);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const key = `${x + dx},${y + dy},${z + dz}`;
        if (cell.has(key) && !seen.has(key)) { seen.add(key); queue.push(key); }
      }
    }
    const loose = boxes.find((b) => !seen.has(`${b.x},${b.y},${b.z}`));
    assert.equal(loose, undefined, `seed ${seed}: the block at ${loose && [loose.x, loose.y, loose.z]} touches no block of the island`);
    const floating = boxes.find((b) => b.z >= 6 && !cell.has(`${b.x},${b.y},${b.z - 1}`));
    assert.equal(floating, undefined, `seed ${seed}: the crown block at ${floating && [floating.x, floating.y, floating.z]} stands on air`);
  }
});

// Draws doodle through a stand-in context that tracks the transform's
// determinant, recording it at every text and at every fill of a 20-point
// outline, which is a note's head; nothing else doodle fills has 20 points.
function doodleSigns(seed) {
  const font = require('../../core/stroke-font.js');
  let det = 1; const stack = []; let n = 0;
  const texts = []; const notes = []; let mirrored = false;
  const g = new Proxy({
    save() { stack.push(det); }, restore() { det = stack.pop(); },
    scale(x, y) { det *= x * y; if (det < 0) mirrored = true; },
    beginPath() { n = 0; }, moveTo() { n = 1; }, lineTo() { n++; },
    fill() { if (n === 20) notes.push(det); },
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
  const text = font.text;
  font.text = () => texts.push(det);
  try { require(path.join(DEMOS, 'doodle.js')).draw(g, { seed, t: 0 }); } finally { font.text = text; }
  return { mirrored, texts, notes };
}

test('doodle draws its words and notes unmirrored on the pages it mirrors, at seeds 1-500', () => {
  let pages = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const { mirrored, texts, notes } = doodleSigns(seed);
    assert.deepEqual([texts.length, notes.length], [6, 2], `seed ${seed}: the title's three passes, TWEET!, ME!, the caption and two notes`);
    if (!mirrored) continue;
    pages++;
    assert.ok(texts.every((d) => d > 0), `seed ${seed}: a word is drawn mirrored`);
    assert.ok(notes.every((d) => d > 0), `seed ${seed}: a note is drawn mirrored`);
  }
  assert.ok(pages >= 200, `only ${pages} of 500 seeds mirror the page`);
});

// Records impasto's background dabs through a stand-in context and returns, per
// colour, how many points of the caption box that colour tops (the last dab covering it).
function impastoCaptionGround(seed) {
  const font = require('../../core/stroke-font.js');
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  const grow = (x, y) => { box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y); };
  font.text(new Proxy({ moveTo: grow, lineTo: grow }, { get: (o, k) => o[k] || (() => {}) }), 'IMPASTO', 40, 950, 14);
  const dabs = [];
  let st = { x: 0, y: 0, a: 0, alpha: 1, fill: null };
  const stack = [];
  let last = null;
  const g = {
    save() { stack.push({ ...st }); }, restore() { st = stack.pop(); },
    translate(x, y) { st.x += x; st.y += y; }, rotate(a) { st.a += a; },
    set fillStyle(v) { st.fill = v; }, get fillStyle() { return st.fill; },
    set globalAlpha(v) { st.alpha = v; }, get globalAlpha() { return st.alpha; },
    beginPath() {}, ellipse(cx, cy, rx, ry) { last = { cx, cy, rx, ry }; },
    fill() { if (st.alpha === 1 && last && last.cx === 0 && last.cy === 0) dabs.push({ x: st.x, y: st.y, a: st.a, len: last.rx, wide: last.ry, c: st.fill }); },
  };
  const ctx = new Proxy(g, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { if (k in o) o[k] = v; return true; } });
  require(path.join(DEMOS, 'impasto.js')).draw(ctx, { seed, t: 0 });
  assert.ok(dabs.length >= 56 * 56, 'the 56 x 56 background dabs are recorded');
  const ground = dabs.slice(0, 56 * 56); // the background comes first
  const covers = (d, x, y) => {
    const dx = x - d.x, dy = y - d.y;
    const u = dx * Math.cos(d.a) + dy * Math.sin(d.a), v = -dx * Math.sin(d.a) + dy * Math.cos(d.a);
    return (u / d.len) ** 2 + (v / d.wide) ** 2 <= 1;
  };
  const tops = new Map();
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
    let c = 'bare';
    for (const d of ground) if (covers(d, x, y)) c = d.c;
    tops.set(c, (tops.get(c) || 0) + 1);
  }
  return tops;
}

// Draws pen-and-pencil through a stand-in context that counts and hashes every
// call, so a draw that throws, or one that stops reading its seed, fails here.
function penAndPencilDigest(seed) {
  const hash = crypto.createHash('sha256');
  let calls = 0;
  const record = (k, args) => { calls++; hash.update(String(k) + ' ' + args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(' ') + '\n'); };
  const g = new Proxy({}, {
    get: (o, k) => {
      if (k in o) return o[k];
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (String(k).startsWith('create')) return () => ({ addColorStop() {} });
      return (...args) => record(k, args);
    },
    set: (o, k, v) => { o[k] = v; record(k, [v]); return true; },
  });
  require(path.join(DEMOS, 'pen-and-pencil.js')).draw(g, { seed, t: 0 });
  return { calls, digest: hash.digest('hex') };
}

test('pen-and-pencil draws the same sheet twice at one seed and another sheet at another', () => {
  const one = penAndPencilDigest(1);
  assert.ok(one.calls > 1000, 'seed 1 draws ' + one.calls + ' calls');
  assert.equal(penAndPencilDigest(1).digest, one.digest, 'seed 1 draws the same sheet twice');
  const two = penAndPencilDigest(2);
  assert.ok(two.calls > 1000, 'seed 2 draws ' + two.calls + ' calls');
  assert.notEqual(two.digest, one.digest, 'seeds 1 and 2 draw the same sheet');
});

test('impasto keeps the caption on a pale ground at seeds 1-9', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const floor = lum('#f7b267'); // fire steps from #f7b267 down are too dark for the caption ink
  const GOLD = '#e9b949'; // the sparse gold dab is darker by value but holds about 4:1 against the ink, so it gets its own bound
  for (let seed = 1; seed <= 9; seed++) {
    const tops = impastoCaptionGround(seed);
    const total = [...tops.values()].reduce((a, b) => a + b, 0);
    const dark = [...tops].filter(([c]) => c !== 'bare' && c !== GOLD && lum(c) <= floor);
    assert.equal(dark.length, 0, `seed ${seed}: dabs as dark as #f7b267 or darker top caption points: ${dark.map(([c, n]) => `${c} x${n}`).join(', ')} of ${total}`);
    const gold = tops.get(GOLD) || 0;
    assert.ok(gold <= total * 0.25, `seed ${seed}: gold tops ${gold} of ${total} caption points, over a quarter`);
  }
});

test('the wall hangs every built-in style that has a site demo, and site.md names the ones without', () => {
  const { HUNG } = require('../pieces/hang.js');
  const builtins = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'artifex', 'styles', 'builtin.json'), 'utf8')).map((s) => s.name);
  const demos = fs.readdirSync(DEMOS).filter((f) => f.endsWith('.js') && f !== 'subject.js').map((f) => f.slice(0, -3));
  assert.deepEqual([...demos].sort(), builtins.filter((name) => demos.includes(name)).sort(), 'every site demo is named after a built-in style');
  // The Kandinsky on the wall is the art shot's own painting; every other work is its style's demo.
  assert.deepEqual([...HUNG].sort(), [...demos].sort(), 'a style with a demo hangs, and nothing else does');
  const bare = builtins.filter((name) => !demos.includes(name));
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'knowledge', 'site.md'), 'utf8');
  const said = /every style in \[`builtin\.json`\]\([^)]*\) but ([^,]*(?:, [^,]*?)*?), in the order/.exec(doc);
  assert.ok(said, 'site.md says which built-in styles the wall leaves out');
  assert.deepEqual([...said[1].matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]).sort(), bare.sort(), 'a new style without a demo is named there, or gets a demo and a place on the wall');
});

test('the box shot fills beyond its box with the page\'s own ground colour', () => {
  const css = fs.readFileSync(path.join(ROOT, 'site', 'site.css'), 'utf8');
  const box = fs.readFileSync(path.join(ROOT, 'site', 'pieces', 'boxed.js'), 'utf8');
  const page = /--ground:\s*(#[0-9a-f]{6})/i.exec(css), shot = /const GROUND = '(#[0-9a-f]{6})'/i.exec(box);
  assert.ok(page && shot, 'site.css declares --ground and boxed.js, which draws the box shot, its GROUND');
  assert.equal(shot[1].toLowerCase(), page[1].toLowerCase(), 'two grounds would show the box\'s edge on the page');
});
