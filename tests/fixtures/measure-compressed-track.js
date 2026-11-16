#!/usr/bin/env node
'use strict';

// Makes and measures compressed-track.js's track in installed Edge: encodes
// decoded-track.cjs's tone, before its 16-bit rounding, as AAC-LC in ADTS frames
// at 96 kbit/s with `AudioEncoder`, says whether the bytes match the fixture's,
// and writes them to out/compressed-track.aac. Then it decodes the fixture's
// bytes at 44.1 and 48 kHz and prints one line of JSON: the decoded lengths,
// whether two 48 kHz decodes hold the same bits, the lag that best aligns the
// 44.1 kHz decode with the source, the first sample above 0.02 in each, and the
// signal-to-error ratio once aligned, and how many samples differ between two
// renders of the fixture's soundtrack. Run it from the repository root:
// `node tests/fixtures/measure-compressed-track.js`.

const fs = require('node:fs');
const path = require('node:path');
const { withEdge, evaluate, waitFor } = require('../../tools/check-browser.js');
const { loadExternal } = require('../../tools/piece-input.js');
const { bundle, html } = require('../../tools/build-page.js');

const ROOT = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(__dirname, 'compressed-track.js'), 'utf8');
const TRACK = source.slice(source.indexOf('const TRACK = ['), source.indexOf("].join('')")).match(/'[^']*'/g).map((s) => s.slice(1, -1)).join('');

const expr = `(async () => {
  const RATE = 44100, LENGTH = 0.3;
  const pcm = Float32Array.from({ length: Math.round(LENGTH * RATE) }, (_, i) => {
    const t = i / RATE;
    return Math.min(1, t / 0.002, (LENGTH - t) / 0.02) * [[1, 0.6, 9], [2.02, 0.25, 14], [3.1, 0.12, 22]]
      .reduce((sum, [ratio, level, fall]) => sum + level * Math.exp(-fall * t) * Math.sin(2 * Math.PI * 330 * ratio * t), 0);
  });
  const chunks = [];
  const encoder = new AudioEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b); }, error: (e) => { throw e; } });
  encoder.configure({ codec: 'mp4a.40.2', sampleRate: RATE, numberOfChannels: 1, bitrate: 96000, aac: { format: 'adts' } });
  encoder.encode(new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: 0, data: pcm }));
  await encoder.flush();
  encoder.close();
  let made = ''; for (const c of chunks) for (const v of c) made += String.fromCharCode(v);
  const track = Uint8Array.from(atob(${JSON.stringify(TRACK)}), (c) => c.charCodeAt(0));
  const decode = (rate) => new OfflineAudioContext(1, rate, rate).decodeAudioData(track.slice().buffer);
  const [at44, a48, b48] = await Promise.all([decode(RATE), decode(48000), decode(48000)]);
  const x = at44.getChannelData(0), a = a48.getChannelData(0), b = b48.getChannelData(0);
  let best = -Infinity, lag = 0;
  for (let k = -3000; k <= 3000; k++) {
    let s = 0;
    for (let i = 0; i < pcm.length; i++) { const j = i + k; if (j >= 0 && j < x.length) s += pcm[i] * x[j]; }
    if (s > best) { best = s; lag = k; }
  }
  let signal = 0, error = 0;
  for (let i = 0; i < pcm.length; i++) { const j = i + lag; signal += pcm[i] ** 2; error += (pcm[i] - (j >= 0 && j < x.length ? x[j] : 0)) ** 2; }
  const onset = (v) => v.findIndex((s) => Math.abs(s) > 0.02);
  return {
    edge: navigator.userAgent.match(/Edg\\/[\\d.]+/)?.[0], made: btoa(made), madeMatchesFixture: btoa(made) === ${JSON.stringify(TRACK)},
    bytes: track.length, sourceSamples: pcm.length, decoded44k: at44.length, decoded48k: a48.length,
    twoDecodesSame: a.length === b.length && a.every((v, i) => v === b[i]),
    lag, lagMs: +(lag / RATE * 1000).toFixed(1), sourceOnset: onset(pcm), decodedOnset: onset(x), alignedSnrDb: +(10 * Math.log10(signal / error)).toFixed(1),
  };
})()`;

// Two renders of the fixture's soundtrack, and how many samples differ between them.
const renders = `(async () => {
  const api = window.__artifex;
  const p = api.piece.validate(api.examples['compressed-track']);
  const render = () => api.render.renderSound(p, api.piece.solve(p, p.seed), { OfflineAudioContext });
  const a = await render(), b = await render();
  let differ = 0;
  for (let c = 0; c < a.numberOfChannels; c++) {
    const x = a.getChannelData(c), y = b.getChannelData(c);
    for (let i = 0; i < x.length; i++) differ += x[i] !== y[i];
  }
  return differ;
})()`;

const page = html(bundle(loadExternal(path.join(__dirname, 'compressed-track.js'), ROOT)), { count: 1 });
withEdge(page, { timeoutMs: 120000 }, async (client, context) => {
  await waitFor(client, context, '!!window.__artifex');
  return { ...(await evaluate(client, expr)), rendersDiffer: await evaluate(client, renders) };
}).then(({ made, ...report }) => {
  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'out', 'compressed-track.aac'), Buffer.from(made, 'base64'));
  console.log(JSON.stringify(report));
}).catch((error) => { console.error(error.message); process.exit(1); });
