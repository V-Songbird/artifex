// The stage's drawing worker. A worker-tier shot draws here, on the stage canvas
// the page handed over as an OffscreenCanvas, so a heavy frame never holds up
// the scroll. It loads the same core.js and shot scripts the page does, and
// answers each draw with its key and time, or with the error that stopped it.
'use strict';

importScripts('core.js');
const req = __require('worker');
const P = req('core/piece.js'), R = req('core/render.js');
const canvases = [], loaded = new Set(), pieces = new Map(), solves = new Map();
let sink = null;

function solved(piece, d) {
  const key = d.id + '|' + d.seed + '|' + JSON.stringify(d.params);
  if (!solves.has(key)) {
    const out = P.solve(piece, d.seed, d.params);
    if (out.stages.error) throw new Error(piece.name + ': build stage "' + out.stages.error.stage + '" threw: ' + out.stages.error.message);
    // A few recipes at most: the ones a visitor moves between.
    if (solves.size >= 4) solves.delete(solves.keys().next().value);
    solves.set(key, out);
  }
  return solves.get(key);
}

onmessage = (event) => {
  const m = event.data;
  if (m.canvas) { canvases[m.slot] = { canvas: m.canvas, g: null }; return; }
  if (m.release) { canvases[m.slot] = null; return; }
  const d = m.draw;
  try {
    const missing = d.scripts.filter((src) => !loaded.has(src));
    if (missing.length) { importScripts(...missing); missing.forEach((src) => loaded.add(src)); }
    if (!pieces.has(d.id)) pieces.set(d.id, P.validate(req(d.id)));
    const piece = pieces.get(d.id), slot = canvases[m.slot];
    if (!slot) throw new Error('no canvas for slot ' + m.slot);
    if (slot.canvas.width !== d.w || slot.canvas.height !== d.h) { slot.canvas.width = d.w; slot.canvas.height = d.h; }
    const g = slot.g || (slot.g = slot.canvas.getContext('2d'));
    if (!g) throw new Error('OffscreenCanvas has no 2d context in this worker');
    const state = solved(piece, d);
    const a = performance.now();
    g.setTransform(1, 0, 0, 1, 0, 0);
    R.drawFrame(g, piece, state, d.t, { scale: d.scale });
    if (d.measure) {
      if (!sink) sink = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
      sink.drawImage(slot.canvas, 0, 0, 1, 1, 0, 0, 1, 1);
      sink.getImageData(0, 0, 1, 1);
    }
    postMessage({ slot: m.slot, key: d.key, ms: performance.now() - a });
  } catch (error) {
    postMessage({ slot: m.slot, key: d.key, error: String(error && error.message || error) });
  }
};
