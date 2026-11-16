'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const crypto = require('node:crypto');
const font = require('../core/stroke-font.js');
const legacy = require('../examples/stroke-font.js');
const { rng } = require('../core/rand.js');
const { VectorSurface } = require('../core/surface-vector.js');
const { bundle } = require('../tools/build-page.js');

// A surface that records every call as one line of text, its style included.
function recorder() {
  const ops = [];
  const g = {
    strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    beginPath() { ops.push('b'); },
    moveTo(x, y) { ops.push('m' + x + ',' + y); },
    lineTo(x, y) { ops.push('l' + x + ',' + y); },
    stroke() { ops.push(`s ${g.strokeStyle} ${g.lineWidth} ${g.lineCap}`); },
  };
  return { g, ops };
}

test('the default face draws and measures exactly as before faces existed', () => {
  // Pinned on main before faces were added: the glyph data, the metrics, and
  // every glyph drawn and measured at three sizes.
  const all = Object.keys(font.GLYPHS).join('');
  const drawn = [];
  const plain = { beginPath() { drawn.push('b'); }, moveTo(x, y) { drawn.push('m' + x + ',' + y); }, lineTo(x, y) { drawn.push('l' + x + ',' + y); }, stroke() { drawn.push('s'); } };
  const pinned = [JSON.stringify(font.GLYPHS), font.ascent, font.descent, font.leading];
  for (const size of [7, 10.5, 14]) pinned.push(font.text(plain, all, 3, 5, size), font.width(all, size));
  pinned.push(drawn.join(' '));
  assert.equal(crypto.createHash('sha256').update(pinned.join('|')).digest('hex'), '10c4b2a9bf5b2c5893a689dafdf85d1bded102761fd269f48f2081aa95d74af7');
  // Naming the default face, or passing options that change nothing, takes the same path.
  const a = recorder(), b = recorder();
  font.text(a.g, all, 3, 5, 10.5);
  font.text(b.g, all, 3, 5, 10.5, { face: 'mono', kern: false, wobble: 0 });
  assert.equal(b.ops.join(' '), a.ops.join(' '));
  assert.equal(font.width(all, 10.5, { face: 'mono' }), font.width(all, 10.5));
  assert.equal(font.faces[0], 'mono');
});

test('every face sets printable ASCII in the shared units and names what it lacks', () => {
  const ascii = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join('');
  for (const face of font.faces) {
    for (const ch of face === 'mono' ? Object.keys(font.GLYPHS).filter((c) => c !== ' ') : ascii) {
      const runs = font.glyph(ch, { face });
      assert.ok(runs.length > 0 && runs.every((run) => run.length >= 2), `${face} ${ch} has runs of two stations or more`);
    }
    // Capitals stand on the cap line and the baseline, as in the default face.
    const ys = font.glyph('H', { face }).flat().map((p) => p[1]);
    assert.equal(Math.min(...ys), 0, face);
    assert.equal(Math.max(...ys), 7, face);
    assert.equal(font.runCount('H H', { face }), 2 * font.glyph('H', { face }).length);
  }
  // A Hershey face has all of printable ASCII and nothing else: accents and
  // turned marks are gaps, named.
  for (const face of font.faces.slice(1)) {
    assert.deepEqual(font.missing(ascii + ' ', { face }), [], face);
    assert.deepEqual(font.missing('¿Qué? ñ', { face }), ['¿', 'é', 'ñ'], face);
  }
  assert.notDeepEqual(font.glyph('a', { face: 'serif' }), font.glyph('a', { face: 'sans' }));
  // The returned runs are copies; changing one changes no later glyph.
  font.glyph('A', { face: 'sans' })[0][0][0] = 99;
  assert.notEqual(font.glyph('A', { face: 'sans' })[0][0][0], 99);
  assert.throws(() => font.glyph('A', { face: 'bodoni' }), /no face 'bodoni'; the faces are mono, sans/);
});

test('width() is where text() ends, in every face, kerned or not, wobbling or not', () => {
  const R = rng(3);
  for (const face of font.faces) {
    for (const opts of [{ face }, { face, kern: true }, { face, kern: true, wobble: 0.06, R }]) {
      for (const str of ['', 'A', 'AVOW TYPE', 'To. Ya, L\'A', 'é🙂x']) {
        const { g } = recorder();
        assert.equal(font.text(g, str, 0, 3, 31, opts), font.width(str, 31, opts), `${face} ${JSON.stringify(opts.kern)} ${str}`);
      }
    }
  }
  assert.equal(font.width('', 20, { face: 'serif', kern: true }), 0);
  // An empty line ends where it starts, on the default path too.
  assert.equal(font.text(recorder().g, '', 12, 3, 31), 12);
  assert.equal(font.width('', 31), 0);
  // A character a face lacks keeps the space's room.
  assert.equal(font.width('xéx', 7, { face: 'sans' }), font.width('x x', 7, { face: 'sans' }));
});

test('kerning closes the pairs it lists and no others, never past half the gap of HH', () => {
  for (const face of font.faces) {
    const k = { face, kern: true };
    assert.ok(font.width('AV', 70, k) < font.width('AV', 70, { face }), face + ' kerns AV');
    assert.ok(font.width('To', 70, k) < font.width('To', 70, { face }), face + ' kerns To');
    assert.ok(Math.abs(font.width('HOH', 70, k) - font.width('HOH', 70, { face })) < 1e-9, face + ' leaves HOH');
    for (const pair of Object.keys(font.KERN)) {
      const by = font.width(pair, 7, k) - font.width(pair, 7, { face });
      assert.ok(by <= 0 && by >= font.KERN[pair] * 7 - 1e-9, `${face} ${pair} kerns ${by}`);
    }
  }
  // The scripts' Y swings under a lower-case letter, so the clamp holds it off.
  assert.ok(font.width('Ya', 7, { face: 'script', kern: true }) - font.width('Ya', 7, { face: 'script' }) > font.KERN.Ya * 7 + 0.01);
});

test('the wobble is the piece\'s: the same R draws the same letters, and it moves ink, not runs or pens', () => {
  const draw = (seed, opts = {}) => {
    const { g, ops } = recorder();
    const end = font.text(g, 'Hand Lettered', 10, 10, 40, { face: 'sans', wobble: 0.05, R: rng(seed), ...opts });
    return { ops: ops.join(' '), end, strokes: ops.filter((op) => op[0] === 's').length };
  };
  const steady = recorder();
  const end = font.text(steady.g, 'Hand Lettered', 10, 10, 40, { face: 'sans' });
  const a = draw(7);
  assert.equal(draw(7).ops, a.ops);
  assert.notEqual(draw(8).ops, a.ops);
  assert.notEqual(draw(7, { name: 'second sign' }).ops, a.ops);
  assert.equal(a.end, end);
  assert.equal(a.strokes, font.runCount('Hand Lettered', { face: 'sans' }));
  assert.notEqual(a.ops, steady.ops.join(' '));
  assert.throws(() => draw(7, { R: undefined }), /wobble needs R/);
});

test('display() strokes shadow, outline and fill over the whole word, on the vector surface too', () => {
  const { g, ops } = recorder();
  const end = font.display(g, 'AT', 0, 0, 70, { face: 'bold', kern: true, fill: 'gold', outline: 'black', shadow: { x: 0.1, y: 0.05, colour: 'red' }, weight: 0.2, line: 0.05 });
  const n = font.runCount('AT', { face: 'bold' });
  const strokes = ops.filter((op) => op[0] === 's' && op !== 'save');
  assert.deepEqual(strokes.map((op) => op.split(' ')[1]), [...Array(n).fill('red'), ...Array(n).fill('black'), ...Array(n).fill('gold')]);
  assert.ok(strokes.every((op, i) => Math.abs(Number(op.split(' ')[2]) - (i < 2 * n ? 21 : 14)) < 1e-9 && op.endsWith(' round')), 'outline and shadow 0.3 cap heights wide, fill 0.2, round caps');
  assert.equal(end, font.text(recorder().g, 'AT', 0, 0, 70, { face: 'bold', kern: true }));
  assert.equal(ops[0], 'save');
  assert.equal(ops.at(-1), 'restore');
  // The shadow is the outline offset by its x and y, letter for letter.
  const moves = ops.filter((op) => op[0] === 'm').map((op) => op.slice(1).split(',').map(Number));
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(moves[i][0] - moves[n + i][0] - 7) < 1e-9 && Math.abs(moves[i][1] - moves[n + i][1] - 3.5) < 1e-9, 'shadow run ' + i);
  }
  // Without an outline or a shadow, only the fill is drawn, in the current colour.
  const plain = recorder();
  plain.g.strokeStyle = 'teal';
  font.display(plain.g, 'AT', 0, 0, 70);
  assert.ok(plain.ops.filter((op) => op.startsWith('s ')).every((op) => op.startsWith('s teal ') && op.endsWith(' round')));
  const svg = new VectorSurface({ w: 400, h: 200 });
  font.display(svg, 'Wham!', 10, 10, 60, { face: 'script', wobble: 0.04, R: rng(1), fill: '#fff', outline: '#000', shadow: {} });
  assert.match(svg.toSVG(), /stroke-linecap="round"/);
});

test('the legacy stroke-font path preserves the canonical module and glyph data identity', () => {
  assert.equal(legacy, font);
  assert.equal(legacy.GLYPHS, font.GLYPHS);
  assert.deepEqual(font.glyph('T'), [[[0, 0], [4, 0]], [[2, 0], [2, 7]]]);
  assert.deepEqual(font.glyph('§'), []);
  assert.deepEqual(font.glyph(' '), []);
});

test('the stroke font names each character of a string it has no glyph for', () => {
  assert.deepEqual(font.missing('WHERE THE RIVER, 1904: FORGETS ITS NAME?'), []);
  assert.deepEqual(font.missing('Lower case sets as written'), []);
  assert.deepEqual(font.missing(''), []);
  // Spanish sets whole: these drew as gaps when the font had capitals only.
  assert.deepEqual(font.missing('¿Qué? ñ é'), []);
  assert.deepEqual(font.missing('¡ÁÉÍÓÚÜÑ áéíóúüñ!'), []);
  // Each named once, in order of first appearance; whole code points, so an
  // astral character is one name, not two halves.
  assert.deepEqual(font.missing('café + 5° + 🙂'), ['+', '°', '🙂']);
  // A newline is not a space: text() sets one line and would leave a gap.
  assert.deepEqual(font.missing('A\nB'), ['\n']);
  // ß has no single capital, so it has no glyph rather than a wrong one.
  assert.deepEqual(font.missing('STRAßE'), ['ß']);
  for (const ch of font.missing('é+°🙂\nß')) assert.deepEqual(font.glyph(ch), [], ch + ' draws as a gap');
});

test('lower case and the Spanish letters draw their own glyphs within the font metrics', () => {
  const ys = (ch) => font.glyph(ch).flat().map((p) => p[1]);
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (const ch of lower + 'áéíóúüñ') {
    assert.notDeepEqual(font.glyph(ch), font.glyph(ch.toUpperCase()), ch + ' draws as its capital');
    // Ascenders reach the cap line, descenders the comma's tail, accents sit under the cap line.
    assert.ok(Math.min(...ys(ch)) >= 0 && Math.max(...ys(ch)) <= 7 + 7 * font.descent + 1e-9, ch + ' leaves the font metrics');
  }
  for (const ch of '¿¡') assert.ok(Math.min(...ys(ch)) >= 0 && Math.max(...ys(ch)) <= 7 + 7 * font.descent + 1e-9, ch + ' leaves the font metrics');
  // An accented letter is its base letter plus a mark; í drops the dot of i.
  for (const ch of 'áéóúüñÁÉÍÓÚÜÑ') {
    const base = font.glyph(ch.normalize('NFD')[0]);
    assert.deepEqual(font.glyph(ch).slice(0, base.length), base, ch + ' keeps its base letter');
    assert.ok(font.glyph(ch).length > base.length, ch + ' has its mark');
  }
  assert.deepEqual(font.glyph('í')[0], font.glyph('i')[0]);
  assert.equal(font.glyph('í').length, font.glyph('i').length);
  // Over a capital the mark rises into the leading by at most 0.2 cap height, so
  // its centre line stays under the deepest mark on the line above.
  for (const ch of 'ÁÉÍÓÚÜÑ') {
    const top = Math.min(...ys(ch));
    assert.ok(top < 0 && top >= -1.4 - 1e-9, `${ch} mark tops out at ${top}`);
    assert.ok(7 * font.leading + top - (7 + 7 * font.descent) > 0, ch + ' reaches the line above');
  }
  // An acute rises to the right steeply enough to read as an acute; over
  // capitals it once rose 7 degrees and read as a macron.
  for (const ch of 'ÁÉÍÓÚáéíóú') {
    const [a, b] = font.glyph(ch).at(-1);
    const deg = (Math.atan2(a[1] - b[1], b[0] - a[0]) * 180) / Math.PI;
    assert.ok(deg >= 25 && deg <= 65, `${ch} acute rises ${deg.toFixed(1)} degrees`);
  }
  // A mark stays clear of its letter by the documented centre-line gap, so a
  // pen lighter than that draws them apart. Marks sit wholly above their
  // letters, so the nearest pair is a station and a segment.
  const near = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const apart = (P, Q) => Math.min(...P.flatMap((r) => r.flatMap((p) => Q.flatMap((s) => s.slice(1).map((b, i) => near(p, s[i], b)))))); // points of P to segments of Q
  for (const ch of 'áéíóúüñÁÉÍÓÚÜÑ') {
    const runs = font.glyph(ch);
    const n = ch === 'í' ? 1 : font.glyph(ch.normalize('NFD')[0]).length;
    const body = runs.slice(0, n), mark = runs.slice(n);
    const gap = Math.min(apart(mark, body), apart(body, mark));
    const least = ch === ch.toUpperCase() ? 0.65 : 1;
    assert.ok(gap >= least - 1e-9, `${ch} mark is ${gap.toFixed(2)} units from its letter, under ${least}`);
  }
  // Still one advance per glyph, no kerning.
  assert.equal(font.width('¿Qué?', 7), font.width('ABCDE', 7));
});

test('the shared stroke font preserves cap-height geometry and independent pen strokes', () => {
  const ops = [];
  const surface = {
    beginPath() { ops.push(['begin']); },
    moveTo(...point) { ops.push(['move', ...point]); },
    lineTo(...point) { ops.push(['line', ...point]); },
    stroke() { ops.push(['stroke']); },
  };
  assert.equal(font.text(surface, 'T', 10, 20, 14), 18);
  assert.equal(font.width('T', 14), 8);
  assert.equal(font.width('', 14), 0);
  assert.equal(font.runCount('T T'), 4);
  assert.deepEqual(ops, [
    ['begin'], ['move', 10, 20], ['line', 18, 20], ['stroke'],
    ['begin'], ['move', 14, 20], ['line', 14, 34], ['stroke'],
  ]);
});

test('width() measures per code point, as text() advances, and leaves BMP strings unchanged', () => {
  const pen = (str, size) => font.text({ beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }, str, 0, 0, size);
  // BMP strings keep the exact values the UTF-16 count gave, bit for bit.
  const old = (str, size) => (str.length === 0 ? 0 : (str.length * 5.4 - (5.4 - 4)) * (size / 7));
  for (const s of ['', 'A', 'AB', 'HELLO WORLD', 'café', '§']) {
    for (const size of [7, 10, 14]) assert.equal(font.width(s, size), old(s, size), `${s} at ${size}`);
  }
  assert.equal(font.width('AB', 7), 9.4);
  // An astral character is one advance, not two: 9.4 drawn, not 14.8.
  assert.equal(font.width('A\u{1F642}', 7), 9.4);
  assert.equal(font.width('A\u{1F642}', 7), pen('A\u{1F642}', 7));
  assert.equal(font.width('\u{1F642}', 7), font.width('A', 7));
});

test('the stroke font measures its ascent, descent and leading from its outlines', () => {
  // Caps stand on 0..7; the comma's tail and the descenders are the deepest station, at 7.8.
  assert.equal(font.ascent, 1);
  assert.ok(Math.abs(font.descent - 0.8 / 7) < 1e-12, `descent ${font.descent}`);
  assert.equal(font.leading, font.ascent + 3 * font.descent);
  // The comma hangs from its own baseline by an upright head, and set at the
  // leading its tail ends two descents above the next line's cap line, so it
  // stays with its line instead of reading as an accent on the letter below.
  const comma = font.glyph(',')[0];
  const tail = Math.max(...comma.map((p) => p[1]));
  assert.ok(comma[0][1] < 7 && comma[1][1] > 7 && comma[0][0] === comma[1][0], 'the comma has an upright head across its baseline');
  assert.ok(7 * font.leading - tail >= 2 * 7 * font.descent - 1e-9, 'the gap below the comma is two descents deep');
  assert.deepEqual(font.glyph(';')[1], comma, 'the semicolon hangs the same comma');
});

test('every face stacks at its own leading with the default face\'s clear gap between lines', () => {
  assert.equal(font.metrics(), font.metrics('mono'));
  assert.deepEqual({ ...font.metrics('mono') }, { ascent: font.ascent, descent: font.descent, leading: font.leading });
  assert.throws(() => font.metrics('bodoni'), /no face 'bodoni'/);
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
  const gap = 2 * font.descent;
  for (const face of font.faces) {
    const m = font.metrics(face);
    const ys = ascii.flatMap((ch) => font.glyph(ch, { face }).flat().map((p) => p[1] / 7));
    // The deepest mark of a line and the highest of the next, set leading apart.
    const clear = m.leading + Math.min(...ys) - Math.max(...ys);
    assert.ok(clear >= gap - 1e-9, `${face}: ${clear.toFixed(3)} cap heights clear at leading ${m.leading.toFixed(3)}, under ${gap.toFixed(3)}`);
    assert.ok(Math.abs(m.ascent + m.descent - (Math.max(...ys) - Math.min(...ys))) < 1e-9, `${face} ascent and descent span its glyphs`);
  }
  // Descenders and ascenders of the letters alone stay clear too: the gap the
  // mono leading closed to nothing in the Hershey faces.
  for (const face of font.faces.slice(1)) {
    const m = font.metrics(face);
    const low = Math.max(...[...'gjpqy'].flatMap((ch) => font.glyph(ch, { face }).flat().map((p) => p[1] / 7)));
    const high = Math.min(...[...'bdhkl'].flatMap((ch) => font.glyph(ch, { face }).flat().map((p) => p[1] / 7)));
    assert.ok(m.leading + high - low > gap, face);
    assert.ok(m.leading > font.leading, `${face} needs more than the default face's leading`);
  }
});

test('the browser bundle resolves both font paths to one module for its example consumers', () => {
  const context = {};
  vm.runInNewContext(bundle(), context);
  const load = context.__require('');
  const canonical = load('core/stroke-font.js');
  assert.equal(load('examples/stroke-font.js'), canonical);
  assert.equal(JSON.stringify(canonical.glyph('T')), JSON.stringify(font.glyph('T')));
  const examples = load('examples/index.js');
  for (const name of ['specimen', 'attractor', 'cover']) assert.equal(examples[name].name, name);
});
