// The showcase stage: the site is one film, and the scroll position is its playhead.
//
// Each shot is an ordinary piece. The stage maps scrollY to a whole frame of the
// site's shot list (shots and shotAt from core/time.js), maps that frame to the
// shot's playhead, and draws only when the piece's own frame, the seed, the
// parameters or the raster size change. It reads the scroll and never writes
// it, except when the visitor starts "Play as film" or opens a recipe link;
// its listeners are passive and nothing calls preventDefault.
//
// Two canvases at most: the shot on screen, and the next one, warmed before
// its join so the join never shows a cold first frame. A shot draws in one of
// three tiers: per frame on the main thread, once per change for a still, or
// in a Worker on an OffscreenCanvas behind its poster. A shot whose frames run
// over budget lowers its raster scale, down to one device pixel per CSS pixel,
// and then moves to the worker tier. Under reduced motion each shot is one
// still, in reading order, and seams are not shown.
//
// The helpers above boot() are pure, and site/tests runs them in Node.

(function () {
  'use strict';

  const VIEWPORT_PER_SECOND = 0.6;      // scroll length of one second of film, in viewport heights
  const PIXEL_CAP = 8294400;            // canvas pixels, the GPU preview's cap
  const JUDGED = 20;                    // draws a scale is judged on
  const SETTLE_MS = 150;                // a main-thread fallback draws once the scroll rests this long

  /** Shot `cut` ({start, end}) shows playhead playheadAt(cut, f, time) at site frame f. */
  function playheadAt(cut, f, time) {
    const n = cut.end - cut.start, l = f - cut.start;
    if (!time || n <= 1) return 0;
    return time.loop ? l / n : l / (n - 1);
  }

  /** The site frame nearest to playhead t of shot `cut`: the inverse of playheadAt. */
  function frameOf(cut, t, time) {
    const n = cut.end - cut.start;
    if (!time || n <= 1) return cut.start;
    const l = Math.round(time.loop ? (t - Math.floor(t)) * n : Math.min(1, Math.max(0, t)) * (n - 1));
    return cut.start + Math.min(n - 1, l);
  }

  /** The recipe a URL query names: shot index, playhead, seed and parameters; null where absent or invalid. */
  function readRecipe(search, names) {
    const q = new URLSearchParams(search), params = {};
    const shot = names.indexOf(q.get('shot'));
    const t = q.has('t') ? Number(q.get('t')) : NaN;
    const seed = /^\d+$/.test(q.get('seed') || '') ? Number(q.get('seed')) : NaN;
    for (const [k, v] of q) if (k.startsWith('p.') && k.length > 2 && v !== '' && Number.isFinite(Number(v))) params[k.slice(2)] = Number(v);
    return {
      shot: shot < 0 ? null : shot,
      t: Number.isFinite(t) && t >= 0 && t <= 1 ? t : null,
      seed: seed <= 0xffffffff ? seed : null,
      params: shot < 0 ? {} : params,
    };
  }

  /** The query for a recipe, as the page writes its own: shot, seed, a four-place playhead and p.<name>. */
  function writeRecipe(r) {
    const q = ['shot=' + encodeURIComponent(r.shot), 'seed=' + r.seed];
    if (r.t !== null) q.push('t=' + r.t.toFixed(4));
    for (const k of Object.keys(r.params)) q.push('p.' + encodeURIComponent(k) + '=' + encodeURIComponent(r.params[k]));
    return '?' + q.join('&');
  }

  /** The 95th percentile, nearest rank. */
  function p95(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
  }

  /**
   * The raster scale a shot should draw at next: `scale` (a share of the full
   * device resolution) unchanged while the last JUDGED draws hold the budget,
   * three quarters of it when they do not, never below one device pixel per
   * CSS pixel, and 0 when nothing is left to lower: the worker tier.
   */
  function lower(scale, dpr, times, budget) {
    if (times.length < JUDGED || p95(times.slice(-JUDGED)) <= budget) return scale;
    const floor = Math.min(1, 1 / dpr);
    return scale <= floor + 1e-9 ? 0 : Math.max(floor, scale * 0.75);
  }

  /** The canvas for a design box fitted inside a view: CSS scale, device scale k, and whole pixels, capped. */
  function fit(size, view, dpr, scale, cap) {
    const css = Math.min(view.w / size.w, view.h / size.h);
    let k = css * dpr * scale;
    if (size.w * k * size.h * k > cap) k = Math.sqrt(cap / (size.w * size.h));
    return { css, k, w: Math.max(1, Math.round(size.w * k)), h: Math.max(1, Math.round(size.h * k)) };
  }

  const helpers = { playheadAt, frameOf, readRecipe, writeRecipe, p95, lower, fit, VIEWPORT_PER_SECOND, PIXEL_CAP, JUDGED };
  if (typeof module === 'object' && module.exports) { module.exports = helpers; return; }

  function boot() {
    const req = __require('stage');
    const P = req('core/piece.js'), R = req('core/render.js'), T = req('core/time.js');
    const data = window.__siteData;
    const film = T.shots(data.shots.map((s) => [s.name, s.seconds]), { hz: data.hz, frames: data.frames });
    const last = data.frames - 1;
    const budget = 1000 / data.hz - 4;
    const doc = document.documentElement;
    const measure = new URLSearchParams(location.search).get('measure') === '1';
    const recipe = readRecipe(location.search, data.shots.map((s) => s.name));
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const stageEl = document.getElementById('stage'), poster = document.getElementById('poster');
    const status = document.getElementById('status'), playButton = document.getElementById('play');
    let seed = recipe.seed === null ? data.seed : recipe.seed;
    let mode = null, pending = 0, playing = null, visible = null, lastFrame = -1, direction = 1, lastScroll = 0;
    let px = 1, worker = null, workerOk = typeof Worker === 'function' && typeof OffscreenCanvas === 'function'
      && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
    let urlTimer = 0, stillQueue = Promise.resolve(), observer = null, sink = null;

    const shots = data.shots.map((s, i) => Object.assign({}, s, {
      index: i, cut: film[i], piece: null, loading: null, solved: null, solvedFor: null,
      params: i === recipe.shot ? recipe.params : {}, scale: 1, times: [], stillFor: null,
    }));

    // What the site check reads. `writes` names every scroll write and why.
    const stat = window.__stage = {
      ready: false, mode: null, frames: data.frames, px: 1, seed, frame: -1, shot: null, draws: 0, log: [],
      stills: 0, writes: [], lowered: [], worker: workerOk ? 'idle' : 'unavailable',
    };

    // --- canvases ---------------------------------------------------------
    function canvas() {
      const c = document.createElement('canvas');
      c.setAttribute('role', 'img');
      c.hidden = true;
      return c;
    }
    const slots = [0, 1].map((n) => {
      const slot = { n, canvas: canvas(), g: null, shot: -1, key: null, fit: null, offscreen: false, busy: false, next: null, drawn: false, timer: 0 };
      stageEl.appendChild(slot.canvas);
      return slot;
    });

    // A canvas handed to the worker cannot draw on the main thread again: replace it.
    function reclaim(slot) {
      const c = canvas();
      c.hidden = slot.canvas.hidden;
      c.setAttribute('aria-label', slot.canvas.getAttribute('aria-label') || '');
      stageEl.replaceChild(c, slot.canvas);
      if (slot.offscreen && worker) worker.postMessage({ slot: slot.n, release: true });
      Object.assign(slot, { canvas: c, g: null, offscreen: false, busy: false, next: null, key: null, fit: null });
    }

    function assign(slot, i) {
      if (slot.shot === i) return;
      clearTimeout(slot.timer);
      Object.assign(slot, { shot: i, key: null, drawn: false, next: null });
      slot.canvas.setAttribute('aria-label', label(shots[i]));
    }

    function label(s) {
      return s.label + ': ' + s.piece.name + ', seed ' + seed;
    }

    // The slot's canvas fits the shot's design box inside the viewport, centred.
    function size(slot) {
      const s = shots[slot.shot], dpr = devicePixelRatio || 1;
      const f = fit(s.piece.size, { w: innerWidth, h: innerHeight }, dpr, s.scale, PIXEL_CAP);
      const style = slot.canvas.style, w = s.piece.size.w * f.css, h = s.piece.size.h * f.css;
      style.width = w + 'px'; style.height = h + 'px';
      style.left = (innerWidth - w) / 2 + 'px'; style.top = (innerHeight - h) / 2 + 'px';
      if (slot.fit && slot.fit.w === f.w && slot.fit.h === f.h) return;
      slot.fit = f; slot.key = null;
      if (!slot.offscreen) { slot.canvas.width = f.w; slot.canvas.height = f.h; }
    }

    function show(slot) {
      if (visible === slot) return;
      visible = slot;
      for (const x of slots) x.canvas.hidden = x !== slot;
      poster.hidden = true;
      if (slot) note(shots[slot.shot].label);
    }

    function note(text) {
      status.textContent = text + '  ·  seed ' + seed;
    }

    // The poster covers a worker-tier shot until its first frame is on screen.
    function posterFor(slot) {
      const s = shots[slot.shot];
      poster.hidden = !(s.poster && !slot.drawn && visible === slot);
      if (poster.hidden) return;
      if (poster.getAttribute('src') !== s.poster) poster.src = s.poster;
      poster.alt = label(s);
      const c = slot.canvas.style;
      Object.assign(poster.style, { left: c.left, top: c.top, width: c.width, height: c.height });
    }

    // --- pieces -------------------------------------------------------------
    const scripts = {};
    function script(src) {
      return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = () => reject(new Error('stage: could not load ' + src));
        document.head.appendChild(el);
      }));
    }

    function load(i) {
      const s = shots[i];
      if (!s.loading) {
        s.loading = Promise.all(s.scripts.map(script)).then(() => {
          s.piece = P.validate(req(s.id));
          request();
        });
      }
      return s.loading;
    }

    function solved(s) {
      const key = seed + JSON.stringify(s.params);
      if (s.solvedFor !== key) {
        let out;
        try { out = P.solve(s.piece, seed, s.params); }
        catch (error) {
          // A recipe's parameter the piece does not accept: drop it, as the page does.
          if (!(error instanceof P.PieceError) || !Object.keys(s.params).length) throw error;
          s.params = {};
          return solved(s);
        }
        if (out.stages.error) throw new Error(s.name + ': build stage "' + out.stages.error.stage + '" threw: ' + out.stages.error.message);
        s.solved = out; s.solvedFor = key;
      }
      return s.solved;
    }

    /** What shot i shows at site frame f: its playhead, the piece's own frame and the draw key. */
    function wanted(i, f) {
      const s = shots[i], t = playheadAt(s.cut, f, s.piece.time), frame = P.frameIndex(s.piece, t);
      return { i, f, t, frame, key: [i, frame, seed, JSON.stringify(s.params)].join('|') };
    }

    // --- drawing --------------------------------------------------------------
    function force(c) {
      // One sink pixel forces the frame to rasterize before the clock is read,
      // only when measuring; the drawing canvas itself is never read back.
      if (!sink) sink = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
      sink.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);
      sink.getImageData(0, 0, 1, 1);
    }

    function record(slot, w, ms, warm, where) {
      const s = shots[slot.shot];
      stat.draws++;
      stat.log.push({ shot: s.index, frame: w.frame, site: w.f, seed, ms: +ms.toFixed(2), warm, where, scale: +s.scale.toFixed(3), w: slot.fit.w });
      if (stat.log.length > 5000) stat.log.splice(0, 1000);
      slot.key = w.key; slot.drawn = true;
      if (visible === slot) { posterFor(slot); stat.ready = true; }
    }

    function drawMain(slot, w, warm) {
      if (slot.offscreen) { reclaim(slot); size(slot); }
      const s = shots[slot.shot];
      const g = slot.g || (slot.g = slot.canvas.getContext('2d'));
      const a = performance.now();
      g.setTransform(1, 0, 0, 1, 0, 0);
      R.drawFrame(g, s.piece, solved(s), w.t, { scale: slot.fit.k });
      if (measure) force(slot.canvas);
      const ms = performance.now() - a;
      record(slot, w, ms, warm, 'main');
      if (!warm) judge(s, ms);
    }

    function drawWorker(slot, w, warm) {
      if (slot.busy) { slot.next = { w, warm }; return; }
      if (!worker) startWorker();
      if (!slot.offscreen) {
        if (slot.g) { reclaim(slot); size(slot); }
        const off = slot.canvas.transferControlToOffscreen();
        slot.offscreen = true;
        worker.postMessage({ slot: slot.n, canvas: off }, [off]);
      }
      const s = shots[slot.shot];
      slot.busy = { w, warm, shot: slot.shot };
      worker.postMessage({ slot: slot.n, draw: {
        id: s.id, scripts: s.scripts, seed, params: s.params, t: w.t, key: w.key, scale: slot.fit.k, w: slot.fit.w, h: slot.fit.h, measure,
      } });
    }

    function startWorker() {
      worker = new Worker('worker.js');
      stat.worker = 'running';
      worker.onmessage = (event) => {
        const m = event.data, slot = slots[m.slot], sent = slot.busy;
        slot.busy = false;
        if (m.error) { fallBack('worker: ' + m.error); return; }
        // The slot moved to another shot, or back to the main thread, meanwhile.
        if (!sent || sent.shot !== slot.shot || !slot.offscreen) { request(); return; }
        record(slot, sent.w, m.ms, sent.warm, 'worker');
        const next = slot.next;
        slot.next = null;
        if (next && next.w.key !== slot.key) drawWorker(slot, next.w, next.warm);
        request();
      };
      worker.onerror = (event) => fallBack('worker failed: ' + (event.message || 'error'));
    }

    // Where the worker route does not work, worker-tier shots draw on the main thread.
    function fallBack(why) {
      workerOk = false;
      stat.worker = 'fell back: ' + why;
      if (worker) worker.terminate();
      worker = null;
      for (const slot of slots) if (slot.offscreen) { reclaim(slot); if (slot.shot >= 0) size(slot); }
      note('drawing on the main thread');
      request();
    }

    function draw(slot, w, warm) {
      const s = shots[slot.shot];
      if (s.tier !== 'worker') { drawMain(slot, w, warm); return; }
      if (workerOk) { drawWorker(slot, w, warm); return; }
      // The fallback draws once the scroll rests, behind the poster, and never warms.
      if (warm) return;
      const rest = SETTLE_MS - (performance.now() - lastScroll);
      clearTimeout(slot.timer);
      if (rest > 0) slot.timer = setTimeout(request, rest);
      else drawMain(slot, w, false);
    }

    // A shot over budget lowers its scale; with nothing left to lower it moves to the worker tier.
    function judge(s, ms) {
      s.times.push(ms);
      const next = lower(s.scale, devicePixelRatio || 1, s.times, budget);
      if (next === s.scale) return;
      s.times = [];
      if (next === 0) { s.tier = 'worker'; stat.lowered.push({ shot: s.name, tier: 'worker' }); }
      else { s.scale = next; stat.lowered.push({ shot: s.name, scale: +next.toFixed(3) }); }
      request();
    }

    // --- the film -------------------------------------------------------------
    function layout() {
      px = stat.px = Math.max(1, innerHeight * VIEWPORT_PER_SECOND / data.hz);
      document.getElementById('spacer').style.height = Math.round(last * px + innerHeight) + 'px';
      for (const s of shots) document.getElementById('shot-' + s.name).style.top = Math.round(s.cut.start * px + innerHeight * 0.5) + 'px';
    }

    function frameNow() {
      return Math.min(last, Math.max(0, Math.round(scrollY / px)));
    }

    function request() {
      if (!pending) pending = requestAnimationFrame(paint);
    }

    function paint() {
      pending = 0;
      if (mode !== 'film') return;
      const f = frameNow();
      if (f !== lastFrame) { if (lastFrame >= 0) direction = f > lastFrame ? 1 : -1; lastFrame = f; }
      const i = T.shotAt(film, f).index, s = shots[i];
      stat.frame = f; stat.shot = s.name;
      if (!s.piece) { load(i); show(null); note('loading ' + s.label); return; }
      const slot = slots.find((x) => x.shot === i) || slots.find((x) => x !== visible) || slots[0];
      assign(slot, i);
      size(slot);
      show(slot);
      const w = wanted(i, f);
      if (slot.key !== w.key) draw(slot, w, false);
      posterFor(slot);
      warm(f);
      clearTimeout(urlTimer);
      urlTimer = setTimeout(writeUrl, 400);
    }

    // Load a neighbour's scripts two seconds of film ahead, and draw its first
    // frame on the other canvas one second ahead, in the direction of travel.
    function warm(f) {
      const j = T.shotAt(film, f).index + direction;
      if (j < 0 || j >= shots.length) return;
      const s = shots[j], edge = direction > 0 ? s.cut.start : s.cut.end - 1;
      const distance = Math.abs(edge - f);
      if (distance > 2 * data.hz) return;
      if (!s.piece) { load(j); return; }
      if (distance > data.hz) return;
      const slot = slots.find((x) => x !== visible);
      assign(slot, j);
      size(slot);
      const w = wanted(j, edge);
      if (slot.key !== w.key && !(slot.busy && slot.busy.w.key === w.key)) draw(slot, w, true);
    }

    // --- recipes --------------------------------------------------------------
    function current() {
      const f = frameNow(), s = shots[T.shotAt(film, f).index];
      if (!s.piece) return null;
      return { shot: s.name, seed, t: s.piece.time ? P.frameT(s.piece, wanted(s.index, f).t) : null, params: s.params };
    }

    function writeUrl() {
      const r = mode === 'film' ? current() : null;
      // Some documents refuse address-bar updates; the recipe is best effort.
      if (r) try { history.replaceState(null, '', writeRecipe(r)); } catch (error) { /* best effort */ }
    }

    function restore() {
      if (recipe.shot === null) return;
      load(recipe.shot).then(() => {
        const s = shots[recipe.shot];
        if (mode !== 'film') return;
        stat.writes.push('recipe');
        scrollTo(0, frameOf(s.cut, recipe.t === null ? 0 : recipe.t, s.piece.time) * px);
      });
    }

    // --- reduced motion: stills in reading order --------------------------------
    function stills() {
      if (!observer) {
        observer = new IntersectionObserver((entries) => {
          for (const e of entries) if (e.isIntersecting) still(Number(e.target.dataset.shot));
        }, { rootMargin: '100% 0px' });
      }
      for (const el of document.querySelectorAll('.still')) { observer.unobserve(el); observer.observe(el); }
    }

    function still(i) {
      const s = shots[i], key = seed + JSON.stringify(s.params);
      if (s.seam || s.stillFor === key) return;
      s.stillFor = key;
      const figure = document.querySelector('.still[data-shot="' + i + '"]');
      stillQueue = stillQueue.then(() => load(i)).then(() => new Promise((resolve) => {
        if (mode !== 'stills') { s.stillFor = null; resolve(); return; }
        const img = figure.querySelector('img') || figure.appendChild(document.createElement('img'));
        img.alt = label(s) + ', still';
        const done = () => { stat.stills++; resolve(); };
        if (s.poster) { img.onload = done; img.src = s.poster; return; }
        // Drawn on a stage canvas, which reduced motion hides, and kept as an image.
        const slot = slots[0];
        if (slot.offscreen) reclaim(slot);
        Object.assign(slot, { shot: -1, key: null, fit: null, drawn: false });
        const width = Math.min(1100, innerWidth) * (devicePixelRatio || 1), k = width / s.piece.size.w;
        slot.canvas.width = Math.round(width); slot.canvas.height = Math.round(s.piece.size.h * k);
        const g = slot.g || (slot.g = slot.canvas.getContext('2d'));
        g.setTransform(1, 0, 0, 1, 0, 0);
        R.drawFrame(g, s.piece, solved(s), s.still, { scale: k });
        slot.canvas.toBlob((blob) => {
          if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
          img.onload = done;
          img.src = URL.createObjectURL(blob);
        });
      }));
    }

    // --- modes, play and controls -----------------------------------------------
    function setMode() {
      const next = reduce.matches && !playing ? 'stills' : 'film';
      if (next === mode) return;
      mode = stat.mode = next;
      doc.classList.toggle('film', mode === 'film');
      if (mode === 'stills') { show(null); note('reduced motion: stills'); stills(); return; }
      for (const slot of slots) slot.key = null;
      layout();
      request();
    }

    function play() {
      if (playing) { stop(); return; }
      let from = 0;
      if (mode === 'film') from = frameNow();
      else {
        // From the still nearest the top of the window.
        const near = shots.filter((s) => !s.seam).map((s) => [Math.abs(document.getElementById('shot-' + s.name).getBoundingClientRect().top), s]);
        near.sort((a, b) => a[0] - b[0]);
        from = near[0][1].cut.start;
      }
      if (from >= last) from = 0;
      playing = { at: performance.now(), from };
      setMode();
      playButton.textContent = 'Pause';
      playButton.setAttribute('aria-pressed', 'true');
      stat.writes.push('play');
      scrollTo(0, from * px);
      requestAnimationFrame(tick);
    }

    function tick(now) {
      if (!playing) return;
      const f = Math.min(last, playing.from + Math.floor((now - playing.at) * data.hz / 1000));
      if (f !== frameNow()) scrollTo(0, f * px);
      if (f >= last) stop();
      else requestAnimationFrame(tick);
    }

    function stop() {
      if (!playing) return;
      const at = shots[T.shotAt(film, frameNow()).index];
      playing = null;
      playButton.textContent = 'Play as film';
      playButton.setAttribute('aria-pressed', 'false');
      setMode();
      if (mode === 'stills') document.getElementById('shot-' + at.name).scrollIntoView();
    }

    function interrupt(event) {
      // The play button toggles by itself; anything else the visitor does stops the film.
      if (playing && event.target !== playButton) stop();
    }

    playButton.addEventListener('click', play);
    document.getElementById('reroll').addEventListener('click', () => {
      seed = stat.seed = (seed + 1) >>> 0;
      for (const slot of slots) { slot.key = null; if (slot.shot >= 0) slot.canvas.setAttribute('aria-label', label(shots[slot.shot])); }
      if (mode === 'stills') stills();
      note('re-rolled');
      writeUrl();
      request();
    });
    document.getElementById('copy').addEventListener('click', () => {
      writeUrl();
      const done = () => note('link copied'), failed = () => note('copy the address bar to share this frame');
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, failed); else failed();
    });
    for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) addEventListener(type, interrupt, { passive: true });
    addEventListener('scroll', () => { lastScroll = performance.now(); request(); }, { passive: true });
    addEventListener('resize', () => { if (mode === 'film') { layout(); request(); } }, { passive: true });
    reduce.addEventListener('change', setMode);

    setMode();
    load(recipe.shot === null ? 0 : recipe.shot);
    restore();
    if (mode === 'stills') stat.ready = true;
  }

  boot();
})();
