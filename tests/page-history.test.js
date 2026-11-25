'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePage } = require('./fake-media.js');

// Execute the emitted application, including startup and event handlers, in
// the shared page sandbox, whose elements are the shared stand-in canvas and
// paint only rectangles; native rendering and downloads need a browser check.
function openPage(replaceState, search = '', registry = null) {
  let now = 0;
  const page = fakePage({
    modules: registry ? { 'examples/index.js': registry } : {},
    replaceState, search, now: () => now,
    fields: () => ({
      _value: '',
      get value() { return this._value; },
      set value(value) {
        if (this.type !== 'range') { this._value = value; return; }
        // Native range inputs sanitize against their current step when value
        // is assigned. The default integer step can round away a fraction;
        // setting a finer step later cannot recover the original value.
        const min = this.min === undefined ? 0 : Number(this.min);
        const max = this.max === undefined ? 100 : Number(this.max);
        const step = this.step === undefined ? 1 : Number(this.step);
        const clamped = Math.min(max, Math.max(min, Number(value)));
        this._value = String(Math.min(max, min + Math.round((clamped - min) / step) * step));
      },
    }),
  });
  return {
    api: page.api, elements: page.elements, downloads: page.downloads, png: page.png, blobs: page.blobs,
    advance(ms) {
      now += ms;
      page.frame(now);
    },
  };
}

test('blocked history replacement preserves selection, editing, playback and image export', async () => {
  let attempts = 0;
  const page = openPage(() => {
    attempts++;
    const error = new Error('The document cannot update its URL');
    error.name = 'SecurityError';
    throw error;
  });
  const { api, elements } = page;
  assert.equal(api.read().name, 'drift');
  assert.equal(api.read().error, null);
  api.select('specimen');
  assert.equal(api.read().name, 'specimen');
  api.select('readout');
  api.setSeed(123);
  assert.equal(api.read().seed, 123);
  const slider = elements.get('params').children.find((child) => child.tag === 'input');
  slider.value = slider.min;
  slider.oninput();
  api.setT(0.25);
  assert.equal(api.read().t, 0.25);
  const play = elements.get('play');
  play.onclick();
  page.advance(100);
  assert.ok(api.read().t > 0.25);
  play.onclick();
  assert.equal(play.textContent, 'play');
  const paused = api.read().t;
  page.advance(100);
  assert.equal(api.read().t, paused);
  page.png.onclick();
  await new Promise(setImmediate);
  assert.equal(elements.get('svg').disabled, false);
  elements.get('svg').onclick();
  assert.deepEqual(page.downloads, ['readout-123@1x.png', 'readout-123.svg']);
  assert.equal(api.read().error, null);
  assert.ok(attempts > 5, 'history was blocked throughout the interactions');
});

test('available history keeps the selected recipe synchronized', () => {
  const urls = [];
  const { api } = openPage((_state, _unused, url) => urls.push(url));
  api.select('drift');
  api.setSeed(456);
  api.setT(0.5);
  assert.equal(urls.at(-1), '?piece=drift&seed=456&t=0.5000');
});

test('public setT synchronizes the visible slider and quantized readout without restarting playback', () => {
  const urls = [];
  const page = openPage((_state, _unused, url) => urls.push(url));
  const { api, elements } = page;
  api.select('readout');
  elements.get('play').onclick();
  for (const requested of [0.5, 0.137, 0, 1]) {
    api.setT(requested);
    const quantized = api.piece.frameT(api.piece.validate(api.examples.readout), requested);
    assert.equal(Number(elements.get('t').value), requested * 1000);
    assert.equal(api.read().t, requested);
    assert.equal(api.manifest().t, quantized);
    assert.equal(elements.get('tread').textContent, quantized.toFixed(3) + ' of 1');
    assert.match(urls.at(-1), new RegExp('t=' + requested.toFixed(4) + '$'));
    assert.equal(elements.get('play').textContent, 'play');
    page.advance(100);
    assert.equal(api.read().t, requested, 'the public time change stops playback');
  }
});

test('blocked history does not hide drawing errors', () => {
  const { api } = openPage(() => { throw new Error('history unavailable'); });
  api.render.drawFrame = () => { throw new Error('drawing failed'); };
  api.setT(0.5);
  assert.equal(api.read().error, 'drawing failed');
});

test('fractional parameter defaults and URL overrides agree with range controls and recipe', () => {
  function registry(module) {
    module.exports = { fractional: {
      name: 'fractional', size: { w: 10, h: 10 },
      params: { warp: { min: 0, max: 2, value: 0.9, meaning: 'changes the width of the mark' } },
      draw(g, state) { g.fillRect(0, 0, state.params.warp, 1); },
    } };
  }
  for (const [search, expected] of [
    ['?piece=fractional', 0.9],
    ['?piece=fractional&p.warp=1.25', 1.25],
  ]) {
    const { api, elements } = openPage(() => {}, search, registry);
    const children = elements.get('params').children;
    const index = children.findIndex((child) => child.textContent === 'warp ');
    const label = children[index].children[0], range = children[index + 2];
    assert.equal(range.type, 'range');
    assert.equal(Number(range.min), 0);
    assert.equal(Number(range.max), 2);
    assert.equal(Number(range.step), 0.01);
    assert.equal(Number(range.value), expected, 'the thumb must retain the resolved fractional value');
    assert.equal(Number(label.textContent), expected);
    assert.equal(api.manifest().params.warp, expected);
  }
});

test('a piece that declares boxes opens at the address bar\'s box, rebuilds from its sliders and records the box', async () => {
  function registry(module) {
    module.exports = {
      boxed: {
        name: 'boxed', size: { w: 100, h: 50 }, boxes: { w: [40, 200], h: [20, 100] }, outputs: ['raster', 'vector'],
        build: [['lay out', (s) => { s.cols = Math.floor(s.box.w / 10); }]],
        draw(g, s) { for (let i = 0; i < s.cols; i++) g.fillRect(i * 10, 0, 8, 8); },
      },
      fixed: { name: 'fixed', size: { w: 10, h: 10 }, draw(g) { g.fillRect(0, 0, 1, 1); } },
    };
  }
  const urls = [];
  const { api, elements, png, blobs } = openPage((_state, _unused, url) => urls.push(url), '?piece=boxed&box=60x40', registry);
  assert.deepEqual({ ...api.read().size }, { w: 60, h: 40 });
  assert.deepEqual({ ...api.manifest().size }, { w: 60, h: 40 });
  assert.equal(elements.get('c').width, 60);
  assert.equal(elements.get('boxGroup').hidden, false);
  const [width, height] = elements.get('boxes').children.filter((child) => child.tag === 'input');
  assert.deepEqual([width.min, width.max, Number(width.value), height.min, height.max, Number(height.value)], [40, 200, 60, 20, 100, 40]);
  width.value = 150;
  width.oninput();
  assert.deepEqual({ ...api.manifest().size }, { w: 150, h: 40 });
  assert.equal(elements.get('c').width, 150);
  assert.match(urls.at(-1), /&box=150x40$/);
  assert.throws(() => api.setBox(300, 40), /boxed cannot draw at 300 x 40/);
  assert.deepEqual({ ...api.read().size }, { w: 150, h: 40 }, 'a refused box leaves the piece where it was');
  // The page's own exports carry the box their recipe records.
  png.onclick();
  await new Promise(setImmediate);
  elements.get('svg').onclick();
  const { pngManifest } = require('../core/export.js');
  const { svgManifest } = require('../core/surface-vector.js');
  assert.deepEqual(pngManifest(new Uint8Array(await blobs.at(-2).arrayBuffer())).size, { w: 150, h: 40 });
  const svg = await blobs.at(-1).text();
  assert.match(svg, /width="150" height="40"/);
  assert.deepEqual(svgManifest(svg).size, { w: 150, h: 40 });
  // A box the piece does not accept is left out of a link, as a stale parameter is.
  assert.deepEqual({ ...openPage(() => {}, '?piece=boxed&box=999x40', registry).api.read().size }, { w: 100, h: 50 });
  api.select('fixed');
  assert.equal(elements.get('boxGroup').hidden, true);
  assert.doesNotMatch(urls.at(-1), /box=/);
});

test('the address bar\'s reframe, t:WxH,..., plays a box timeline, is refused by name through atBox, and the player plays a timeline fitted whole', () => {
  function registry(module) {
    const piece = (name, reframe) => ({
      name, size: { w: 100, h: 50 }, boxes: { w: [40, 200], h: [20, 100] }, outputs: ['raster'], time: { duration: 1, hz: 10 }, reframe,
      draw(g, s, t, clock) { const b = clock && clock.box; g.fillRect(b ? b.x : 0, 0, b ? b.w : 1, 1); },
    });
    module.exports = {
      own: piece('own', [{ t: 0, w: 100, h: 50 }, { t: 1, w: 50, h: 50 }]),
      plain: piece('plain', null),
    };
  }
  const keys = [{ t: 0, w: 60, h: 50 }, { t: 0.5, w: 100, h: 20 }];
  const urls = [];
  const { api } = openPage((_state, _unused, url) => urls.push(url), '?piece=plain&reframe=0:60x50,0.5:100x20', registry);
  assert.equal(api.read().error, null);
  assert.deepEqual({ ...api.read().size }, { w: 100, h: 50 }, 'the frame is the largest box');
  assert.deepEqual(JSON.parse(JSON.stringify(api.manifest().reframe)), keys, 'the recipe carries the chosen timeline');
  assert.match(urls.at(-1), /&reframe=0:60x50,0\.5:100x20$/);
  api.setBox(80, 40);
  assert.equal(api.manifest().reframe, undefined, 'one box replaces the timeline');
  assert.match(urls.at(-1), /&box=80x40$/);
  api.setReframe(keys);
  assert.match(urls.at(-1), /&reframe=0:60x50,0\.5:100x20$/);
  assert.throws(() => api.setReframe([{ t: 0, w: 60, h: 50 }, { t: 0, w: 100, h: 20 }]), /plain cannot play that box timeline: reframe\[1\]\.t must come after reframe\[0\]\.t/);
  // The piece's own timeline is not named in its link.
  api.select('own');
  assert.doesNotMatch(urls.at(-1), /reframe=|box=/);
  // A timeline the piece cannot play, or cannot be read, is refused by name and the piece keeps its own box.
  for (const [search, why] of [
    ['?piece=plain&reframe=0:60x50,0.5:300x20', /plain cannot play that box timeline: box 1, 300 x 20: .*The piece keeps its own box\.$/],
    ['?piece=plain&reframe=0:60x50', /plain cannot play that box timeline: must be null or/],
    ['?piece=plain&reframe=60x50,1:100x20', /reframe: box 0, "60x50", must be t:WIDTHxHEIGHT/],
  ]) {
    const refused = openPage(() => {}, search, registry).api;
    assert.match(refused.read().error, why, search);
    assert.deepEqual({ ...refused.read().size }, { w: 100, h: 50 }, search);
    assert.equal(refused.manifest().reframe, undefined, search);
  }
  // The live player plays a timeline, its own or the address bar's, fitted whole into the window; without one it takes the window's box.
  const player = (search) => fakePage({
    modules: { 'examples/index.js': registry }, search: search + '&player=1', fields: () => ({ style: {} }),
    window: { innerWidth: 400, innerHeight: 400, addEventListener() {} },
  });
  for (const [search, reframe] of [['?piece=own', [{ t: 0, w: 100, h: 50 }, { t: 1, w: 50, h: 50 }]], ['?piece=plain&reframe=0:60x50,0.5:100x20', keys]]) {
    const { api: p, elements } = player(search);
    assert.deepEqual({ ...p.read().size }, { w: 100, h: 50 }, search);
    assert.deepEqual(JSON.parse(JSON.stringify(p.manifest().reframe)), reframe, search);
    assert.deepEqual([elements.get('c').width, elements.get('c').height], [400, 200], 'the frame fitted whole: ' + search);
  }
  assert.deepEqual({ ...player('?piece=plain').api.read().size }, { w: 200, h: 100 }, 'the window\'s box, held in the declared ranges');
});
