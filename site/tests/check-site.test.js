'use strict';

// The site check's pure helpers. The walk itself needs installed Edge:
// node tools/check-site.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { countDraws } = require('../../tools/check-site.js');

const at = (shot, frame, scale = 1) => ({ shot, frame, seed: 1, scale });

test('site check: a refused argument is named, then the usage line, and --help and -h print the usage', () => {
  const { parseArgs } = require('../../tools/check-site.js');
  for (const [args, cause] of [
    [['--bogus'], 'site check: unknown option --bogus'],
    [['--edge'], 'site check: --edge needs the path to msedge'],
    // tests/cli.test.js covers --timeout-ms, where the mutation suite reaches it.
  ]) assert.throws(() => parseArgs(args), { message: cause + '\nusage: node tools/check-site.js [--edge PATH] [--timeout-ms N] [--headed]' }, args.join(' '));
  // Without --timeout-ms the deadline follows the film's frames, 300,000 ms at least.
  const { deadline } = require('../../tools/check-site.js');
  assert.equal(parseArgs([]).timeoutMs, null);
  assert.equal(parseArgs(['--timeout-ms', '5000']).timeoutMs, 5000);
  assert.deepEqual([100, 4620].map(deadline), [300000, 1155000]);
  const { execFileSync } = require('node:child_process');
  const file = require.resolve('../../tools/check-site.js');
  for (const flag of ['--help', '-h']) assert.match(execFileSync(process.execPath, [file, flag], { encoding: 'utf8' }), /^usage: node tools\/check-site\.js [^\n]+\n$/, flag);
});

test('site check: a redraw of a frame after a scale change is counted apart, once per change', () => {
  assert.deepEqual(countDraws([at(0, 0), at(0, 1), at(1, 0)]), { distinct: 3, redraws: 0, extra: 0 });
  // Lowered on frame 1: the same frame again at the new scale is the one redraw it allows.
  assert.deepEqual(countDraws([at(0, 0), at(0, 1), at(0, 1, 0.75), at(0, 2, 0.75)]), { distinct: 3, redraws: 1, extra: 0 });
  // A second draw of it at that scale is a duplicate.
  assert.deepEqual(countDraws([at(0, 1), at(0, 1, 0.75), at(0, 1, 0.75)]), { distinct: 1, redraws: 1, extra: 1 });
  // So is a draw of a frame already drawn, at the same scale, or after other frames.
  assert.deepEqual(countDraws([at(0, 1), at(0, 1)]), { distinct: 1, redraws: 0, extra: 1 });
  assert.deepEqual(countDraws([at(0, 1), at(0, 2), at(0, 1, 0.75)]), { distinct: 2, redraws: 0, extra: 1 });
  // Two lowerings on one frame allow two redraws.
  assert.deepEqual(countDraws([at(0, 4), at(0, 4, 0.75), at(0, 4, 0.563)]), { distinct: 1, redraws: 2, extra: 0 });
});

test('site check: the measuring sink must show a heavy frame\'s rasterization, or the check fails', () => {
  const { sinkWaits } = require('../../tools/check-site.js');
  const times = (none, forced, copied) => ({ none: [none, none + 1, none - 0.1], forced: [forced, forced + 1, forced - 0.1], copied: [copied, copied + 1, copied - 0.1] });
  // A sink that waits: forced near the whole-frame copy, far over the calls alone.
  assert.equal(sinkWaits(times(0.4, 43.5, 49.6)).failure, undefined);
  assert.deepEqual(sinkWaits(times(0.4, 43.5, 49.6)), { noneMs: 0.4, forcedMs: 43.5, copiedMs: 49.6 });
  // One that stopped waiting measures the calls alone.
  assert.match(sinkWaits(times(0.4, 0.6, 49.6)).failure, /does not wait for rasterization/);
  // Under half the copy fails, even when well over the calls.
  assert.match(sinkWaits(times(0.4, 20, 49.6)).failure, /does not wait/);
  // A frame too light to tell (forced under three times the calls) fails rather than passing.
  assert.match(sinkWaits(times(2, 5, 6)).failure, /does not wait/);
});

test('site check: a frame played as film is judged against the sound heard as it was drawn, from the start of its own shot', () => {
  const { syncLags } = require('../../tools/check-site.js');
  const film = [{ name: 'a', start: 0, end: 60 }, { name: 'b', start: 60, end: 120 }];
  // The context plays out audio time 10 at page time 5000 ms; b started at audio time 11, from its start.
  const clock = { contextTime: 10, performanceTime: 5000 };
  const starts = [{ shot: 'a', when: 9, offset: 0 }, { shot: 'b', when: 11, offset: 0 }];
  // Frame 70 (b's tenth) drawn at audio 11.35: b heard 0.35 s in, its frame's middle at 0.35.
  const [on] = syncLags([{ site: 70, at: 6350 }], starts, clock, film, 30);
  assert.equal(on.shot, 'b');
  assert.equal(on.lagMs + 0, 0);
  // The same frame drawn 40 ms later is 40 ms behind its sound: more than one frame at 30 Hz.
  assert.equal(syncLags([{ site: 70, at: 6390 }], starts, clock, film, 30)[0].lagMs, 40);
  // A frame of b drawn before b started is not judged, nor one of a shot never started.
  assert.deepEqual(syncLags([{ site: 61, at: 5900 }], starts, clock, film, 30), []);
  assert.deepEqual(syncLags([{ site: 70, at: 6350 }], starts.slice(0, 1), clock, film, 30), []);
});

test('site check: a page PieceError is refused as site check: <phase>: <its message>', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { runSiteCheck } = require('../../tools/check-site.js');
  const { validate } = require('../../core/piece.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-site-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'data.js'), 'window.__siteData = ' + JSON.stringify({ frames: 60, hz: 30, shots: [] }) + ';\n');
  let error;
  try { validate({ name: 'demo', size: { w: 32, h: 24 }, sound() {}, draw() {} }); } catch (e) { error = e; }
  // A stand-in for withEdge whose page reports the PieceError as it loads; the
  // client carries the options' command, as withEdge's does. No browser at
  // --edge's path, so a run that ignores the stand-in stops there.
  const edge = (page, options, work) => {
    const context = { errors: [], phase: 'page navigation', version: { Browser: 'Stand-in/1' } };
    return work({ command: options.command, send: async (method) => {
      if (method === 'Page.navigate') context.errors.push(error.stack);
      return method === 'Runtime.evaluate' ? { result: { value: false } } : {};
    } }, context);
  };
  await assert.rejects(runSiteCheck({ dir, edge: path.join(dir, 'no-such-edge.exe') }, edge),
    { message: 'site check: desktop walk: ' + error.message, pageRefusal: true });
});

test('site check: a state the page never reaches is refused with the expression waited for, and the report so far is kept', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { runSiteCheck } = require('../../tools/check-site.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-site-wait-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'data.js'), 'window.__siteData = ' + JSON.stringify({ frames: 60, hz: 30, shots: [] }) + ';\n');
  // A stand-in for withEdge whose page never becomes ready.
  const edge = (page, options, work) => work({ command: options.command, send: async (method) => (method === 'Runtime.evaluate' ? { result: { value: false } } : {}) },
    { errors: [], phase: 'page navigation', version: { Browser: 'Stand-in/1' } });
  const started = Date.now();
  const error = await runSiteCheck({ dir, waitMs: 120, edge: path.join(dir, 'no-such-edge.exe') }, edge).then(() => null, (e) => e);
  assert.equal(error && error.message, 'site check: waited 120 ms for document.readyState === "complete" && !!window.__stage && __stage.ready');
  assert.ok(Date.now() - started < 5000, 'the wait is bounded');
  assert.deepEqual(error.partial, { walks: [], browser: 'Stand-in/1', frames: 60, hz: 30, timeoutMs: 300000, shots: [], failures: [] });
});

test('site check: the audit names a control without a name, too small, never reached, without a ring or covered, a canvas without a label and text under 4.5 to 1', () => {
  const { judgeAudit, outside } = require('../../tools/check-site.js');
  const ink = [35, 32, 28, 1], card = [239, 234, 224, 0.9];
  const good = () => ({
    lang: 'en', status: true,
    controls: [{ id: 'play', w: 95, h: 28 }, { id: 'box', w: 120, h: 24 }],
    named: [{ role: 'button', name: 'Play as film' }, { role: 'slider', name: 'Box width' }],
    tabbed: [{ id: 'box', ring: true, clear: true }, { id: 'play', ring: true, clear: true }],
    canvases: [{ role: 'img', label: 'Any box: site-box, seed 1' }],
    text: [{ what: 'Any box', color: ink, ground: card }],
  });
  assert.deepEqual(judgeAudit(good()), []);
  const bad = (change) => { const r = good(); change(r); return judgeAudit(r); };
  assert.deepEqual(bad((r) => { r.named[0].name = ''; }), ['audit: a button has no name for assistive technology']);
  assert.deepEqual(bad((r) => { r.named.pop(); }), ['audit: the accessibility tree has 1 controls and the page shows 2']);
  assert.deepEqual(bad((r) => { r.controls[0].h = 20; }), ['audit: the control play is 95 by 20 CSS px, under 24 by 24']);
  assert.deepEqual(bad((r) => { r.tabbed.pop(); }), ['audit: Tab never reaches the control play']);
  assert.deepEqual(bad((r) => { r.tabbed[1].ring = false; }), ['audit: the control play shows no focus ring']);
  assert.deepEqual(bad((r) => { r.tabbed[1].clear = false; }), ['audit: the control play is covered where it takes the focus']);
  assert.deepEqual(bad((r) => { r.canvases[0].label = ''; }), ['audit: a stage canvas has the role img and the label ""']);
  assert.deepEqual(bad((r) => { r.status = false; }), ['audit: the page has no status region']);
  // A card half see-through lets a dark picture through: judged over black, the dark ink fails.
  assert.match(bad((r) => { r.text[0].ground = [239, 234, 224, 0.3]; })[0], /^audit: the text "Any box" has a contrast of \d\.\d\d to 1 against its ground, under 4\.5$/);
  assert.deepEqual(outside(['http://127.0.0.1:5000/', 'http://127.0.0.1:5000/core.js', 'blob:http://127.0.0.1:5000/x', 'data:,', 'https://fonts.example/a.woff2', 'http://127.0.0.1:50001/x'], 'http://127.0.0.1:5000'),
    ['https://fonts.example/a.woff2', 'http://127.0.0.1:50001/x']);
});

test('site check: the box path is checked on the shots whose pieces declare boxes, read from the built data', () => {
  const { boxShots } = require('../../tools/check-site.js');
  // Sizes no source declares: the check judges what the build holds.
  const built = { name: 'box', id: 'b', scripts: [], size: { w: 300, h: 200 }, boxes: { w: [100, 600], h: [100, 700] } };
  const found = boxShots([{ name: 'contain', id: 'a' }, built, { name: 'rows', id: 'c' }]);
  assert.deepEqual(found, [{ name: 'box', id: 'b', size: { w: 300, h: 200 }, boxes: { w: [100, 600], h: [100, 700] } }]);
});
