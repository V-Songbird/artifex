// The product page: a live hero, the widgets that teach how a piece works, a
// card into the film, and the install. Every picture is a piece drawn here by
// core/render.js; every sound comes from core/sound.js through a piece's sound,
// silent until the visitor turns Listen on.
//
// The hero's scripts load first; the teaching piece's when its section nears
// the screen; the sound and the exporter only when asked for. Under reduced
// motion every piece is drawn once, at its last playhead, and nothing plays.

(function () {
  'use strict';

  const req = __require('home');
  const P = req('core/piece.js'), R = req('core/render.js');
  const data = window.__siteData, home = data.home;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const status = document.getElementById('status');
  const say = (text) => { status.textContent = text; };
  const stat = window.__home = { ready: false, draws: 0, heroDraws: 0, hero: null, widgets: {}, sounds: [], listen: false, errors: [] };

  const scripts = {};
  function script(src) {
    return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => { delete scripts[src]; reject(new Error('could not load ' + src)); };
      document.head.appendChild(el);
    }));
  }
  const loads = {};
  // The pen is heard through the intro's heard piece: the same plotter on the same plot as the hero.
  const entry = (name) => (name === 'heard' ? data.shots[0].heard : home[name]);
  const piece = (name) => loads[name] || (loads[name] = Promise.all(entry(name).scripts.map(script)).then(() => P.validate(req(entry(name).id))));

  /** Draw `p`, solved, at playhead t on `canvas`, sized to its box in CSS pixels at the device's resolution. */
  function paint(canvas, p, solved, t) {
    const dpr = Math.min(devicePixelRatio || 1, 2), css = canvas.clientWidth || p.size.w;
    const k = (css / p.size.w) * dpr, w = Math.round(p.size.w * k), h = Math.round(p.size.h * k);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    R.drawFrame(g, p, solved, t, { scale: k, reducedMotion: reduce.matches });
    stat.draws++;
  }

  /** Run `frame(t)` from playhead 0 to 1 over `seconds`; under reduced motion only frame(1). Returns a stop function. */
  function play(seconds, frame) {
    if (reduce.matches) { frame(1); return () => {}; }
    let start = null, id = 0;
    const step = (now) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / 1000 / seconds);
      frame(t);
      if (t < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }

  // --- theme ------------------------------------------------------------------
  const themeButton = document.getElementById('theme');
  function themeNow() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
  function showTheme() {
    const dark = themeNow() === 'dark';
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.textContent = 'Dark theme';
  }
  themeButton.addEventListener('click', () => {
    const next = themeNow() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('artifex-theme', next); } catch (e) { /* the choice lasts this visit only */ }
    showTheme();
    cue(next === 'dark' ? 'on' : 'off');
  });
  showTheme();

  // --- sound --------------------------------------------------------------------
  // Off until Listen: then the interface sounds render once from the ui piece,
  // and each event plays its slice; the hero's pen is heard as it writes.
  const listenButton = document.getElementById('listen');
  let audio = null, uiBuffer = null, cues = null, heardPiece = null, penSource = null;
  function context() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function cue(name) {
    if (!stat.listen || !uiBuffer || !cues[name]) return;
    const src = audio.createBufferSource(), [at, length] = cues[name];
    src.buffer = uiBuffer;
    src.connect(audio.destination);
    src.start(0, at, length);
    stat.sounds.push(name);
  }
  listenButton.addEventListener('click', () => {
    stat.listen = !stat.listen;
    listenButton.setAttribute('aria-pressed', String(stat.listen));
    if (!stat.listen) { stopPen(); if (audio) audio.suspend(); say('Listen is off'); return; }
    context();
    say('loading the sounds');
    Promise.all([piece('ui'), piece('heard')]).then(([ui, heard]) => {
      cues = ui.sound.cues;
      heardPiece = heard;
      return uiBuffer || R.renderSound(ui, P.solve(ui, ui.seed, {}));
    }).then((buffer) => {
      uiBuffer = buffer;
      if (!stat.listen) return;
      say('Listen is on: the page sounds its controls, and the pen as it writes');
      cue('on');
    }).catch((error) => { stat.listen = false; listenButton.setAttribute('aria-pressed', 'false'); say('the sounds could not be loaded: ' + error.message); });
  });
  function stopPen() { if (penSource) { try { penSource.stop(); } catch (e) { /* already ended */ } penSource = null; } }
  function pen(seed) {
    stopPen();
    if (!stat.listen || !heardPiece || reduce.matches) return;
    R.renderSound(heardPiece, P.solve(heardPiece, seed, {})).then((buffer) => {
      if (!stat.listen) return;
      penSource = audio.createBufferSource();
      penSource.buffer = buffer;
      penSource.connect(audio.destination);
      penSource.start();
    });
  }

  // --- the hero -----------------------------------------------------------------
  // The name, written by the plotter. The pointer over the sheet sets the
  // piece's two declared parameters, across for the line, down for the soak;
  // the two sliders under it set the same values from the keyboard.
  const hero = { canvas: document.getElementById('hero-canvas'), seed: data.seed, params: {}, t: 0, p: null, solved: null, stop: () => {} };
  const heroInputs = Array.from(document.querySelectorAll('#hero [data-param]'));
  function heroDraw() {
    if (!hero.p) return;
    paint(hero.canvas, hero.p, hero.solved, hero.t);
    stat.heroDraws++;
    stat.hero = { seed: hero.seed, params: Object.assign({}, hero.params), t: hero.t };
    stat.ready = true;
  }
  function heroSolve() { hero.solved = P.solve(hero.p, hero.seed, hero.params); }
  function heroWrite() {
    hero.stop();
    heroSolve();
    pen(hero.seed);
    hero.stop = play(hero.p.time.duration, (t) => { hero.t = t; heroDraw(); });
  }
  function heroParam(name, value) {
    const spec = hero.p.params[name];
    hero.params[name] = Math.min(spec.max, Math.max(spec.min, value));
    for (const input of heroInputs) if (input.dataset.param === name) input.value = hero.params[name];
    heroSolve();
    heroDraw();
  }
  // A style's page has no hero: it is ready once its demo is drawn.
  if (hero.canvas) piece('hero').then((p) => {
    hero.p = p;
    for (const input of heroInputs) {
      const spec = p.params[input.dataset.param];
      Object.assign(input, { min: spec.min, max: spec.max, step: (spec.max - spec.min) / 100, value: spec.value });
      input.addEventListener('input', () => { heroParam(input.dataset.param, Number(input.value)); cue('slide'); });
    }
    hero.canvas.addEventListener('pointermove', (event) => {
      const r = hero.canvas.getBoundingClientRect(), x = (event.clientX - r.left) / r.width, y = (event.clientY - r.top) / r.height;
      const at = (name, u) => { const s = p.params[name]; return s.min + Math.min(1, Math.max(0, u)) * (s.max - s.min); };
      hero.params.weight = at('weight', x);
      heroParam('soak', at('soak', y));
    });
    document.getElementById('hero-seed').addEventListener('click', () => {
      hero.seed = (hero.seed * 1103515245 + 12345) >>> 0 || 1;
      cue('roll');
      heroWrite();
      say('seed ' + hero.seed + ': the same seed always writes the same sheet');
    });
    heroWrite();
    addEventListener('resize', heroDraw);
  }).catch((error) => { stat.errors.push(String(error.message || error)); say('the hero could not be drawn: ' + error.message); });

  // --- how it works: one piece, five widgets -----------------------------------
  const widgets = Array.from(document.querySelectorAll('.widget'));
  let tides = null;
  function tidesPiece() { return tides || (tides = piece('teach')); }

  // Each widget opens at a seed of its own, so the five pictures differ before anyone touches them.
  const SEEDS = { seed: 3, playhead: 7, params: 21, box: 11, exports: 2 };

  const setups = {
    // The same seed draws the same picture: two canvases, one seed.
    seed(el, p) {
      const [a, b] = el.querySelectorAll('canvas'), out = el.querySelector('output');
      let seed = SEEDS.seed;
      const draw = () => { const s = P.solve(p, seed, {}); paint(a, p, s, 1); paint(b, p, s, 1); out.value = 'seed ' + seed; };
      el.querySelector('button').addEventListener('click', () => { seed = (seed * 69069 + 1) >>> 0 || 1; cue('roll'); draw(); });
      return draw;
    },
    // The playhead is time: drag it and the pen goes back and forth.
    playhead(el, p) {
      const c = el.querySelector('canvas'), range = el.querySelector('input'), button = el.querySelector('button');
      const s = P.solve(p, SEEDS.playhead, {});
      let stop = () => {};
      const at = (t) => { range.value = t; paint(c, p, s, t); };
      range.addEventListener('input', () => { stop(); at(Number(range.value)); });
      button.addEventListener('click', () => { stop(); cue('tap'); stop = play(p.time.duration, at); });
      return () => at(Number(range.value));
    },
    // Parameters reshape the picture: each slider is a declared parameter, labelled by its meaning.
    params(el, p) {
      const c = el.querySelector('canvas'), inputs = Array.from(el.querySelectorAll('input')), params = { lines: 36, swell: 0.95 };
      for (const input of inputs) {
        const spec = p.params[input.dataset.param];
        Object.assign(input, { min: spec.min, max: spec.max, step: (spec.max - spec.min) / 100, value: params[input.dataset.param] });
        input.addEventListener('input', () => { params[input.dataset.param] = Number(input.value); cue('slide'); draw(); });
      }
      const draw = () => paint(c, p, P.solve(p, SEEDS.params, params), 1);
      return draw;
    },
    // The box recomposes the picture, never stretches it.
    box(el, p) {
      const c = el.querySelector('canvas'), range = el.querySelector('input'), out = el.querySelector('output');
      Object.assign(range, { min: p.boxes.w[0], max: p.boxes.w[1], step: 10, value: 520 });
      const draw = () => {
        const q = P.atBox(p, { w: Number(range.value), h: p.size.h });
        c.style.width = (100 * q.size.w / p.boxes.w[1]).toFixed(2) + '%';
        paint(c, q, P.solve(q, SEEDS.box, {}), 1);
        out.value = q.size.w + ' by ' + q.size.h;
      };
      range.addEventListener('input', () => { cue('slide'); draw(); });
      return draw;
    },
    // One recipe, every file: each carries the recipe that draws it again.
    exports(el, p) {
      const c = el.querySelector('canvas'), s = P.solve(p, SEEDS.exports, {});
      let busy = false, exporter = null;
      const E = () => exporter || (exporter = script(data.exports.script).then(() => req(data.exports.module), (error) => { exporter = null; throw error; }));
      for (const button of el.querySelectorAll('button[data-kind]')) {
        button.addEventListener('click', () => {
          if (busy) { say('a file is still being made'); return; }
          busy = true;
          cue('tap');
          const kind = button.dataset.kind;
          say(kind === 'film' ? 'drawing and encoding the film' : 'drawing the ' + kind.toUpperCase());
          E().then((x) => {
            if (kind === 'png') return x.png(p, s, 1, 2).then((blob) => [x, blob, x.fileName('png', p.name, s.seed, 2)]);
            if (kind === 'svg') return [x, new Blob([x.svg(p, s, 1)], { type: 'image/svg+xml' }), x.fileName('svg', p.name, s.seed)];
            return x.filmOffer(p, {}).then((choice) => (choice.format === 'webm' ? x.webm(p, s, p.name) : x.mp4(p, s, p.name)))
              .then((r) => [x, r.blob, r.name]);
          }).then(([x, blob, name]) => { x.save(blob, name); say('saved ' + name + ': it carries its recipe'); })
            .catch((error) => say(error.message || String(error)))
            .then(() => { busy = false; });
        });
      }
      return () => paint(c, p, s, 1);
    },
  };

  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      seen.unobserve(entry.target);
      const el = entry.target, name = el.dataset.widget;
      tidesPiece().then((p) => {
        const draw = setups[name](el, p);
        draw();
        stat.widgets[name] = true;
        addEventListener('resize', draw);
      }).catch((error) => { stat.errors.push(name + ': ' + (error.message || error)); say('the ' + name + ' widget could not be drawn: ' + error.message); });
    }
  }, { rootMargin: '300px' });
  widgets.forEach((el) => seen.observe(el));

  // --- every style: a card per built-in style, and each style's page -----------------
  // Cards and the style page draw in the site's worker, on a canvas it keeps, so no draw holds up the page. The
  // worker counts the marks a draw lays and, asked, copies the canvas every so many marks: a card plays those
  // copies back as its marks being laid, on hover and focus. A style that draws slowly shows its poster, drawn
  // from the same recipe, until its card is ready. Without a worker, a card draws here once and holds.
  const styles = Object.fromEntries((data.styles || []).map((s) => [s.name, s]));
  const page = document.querySelector('.style-page');
  const offThread = typeof Worker === 'function' && typeof OffscreenCanvas === 'function';
  const COPIES = 24, LAID_MS = 1600;
  const nextSeed = (seed) => (seed * 69069 + 1) >>> 0 || 1;
  stat.cards = {};
  let painter = null, busy = null, keys = 0;
  const queue = [];
  function next() {
    if (busy || !queue.length) return;
    queue.sort((a, b) => b.priority - a.priority);
    busy = queue.shift();
    const s = styles[busy.v.name];
    if (!painter) {
      painter = new Worker('worker.js');
      painter.onmessage = (event) => { const job = busy; busy = null; shown(job, event.data); next(); };
    }
    painter.postMessage({ lay: { key: busy.key, id: s.id, scripts: s.scripts, seed: busy.seed, params: busy.params, w: busy.w, h: busy.h, scale: busy.scale, every: busy.every } });
  }
  const here = {};
  function stylePiece(name) { return here[name] || (here[name] = Promise.all(styles[name].scripts.map(script)).then(() => P.validate(req(styles[name].id)))); }
  /** Draw view `v` at its seed and parameters; `every` asks for a copy every that many marks, to play them laid. */
  function drawView(v, every = 0, priority = 0) {
    const s = styles[v.name], dpr = Math.min(devicePixelRatio || 1, 2), css = v.canvas.clientWidth || 300;
    const w = Math.round(css * dpr), scale = w / s.size.w, h = Math.round(s.size.h * scale);
    const job = { v, key: ++keys, seed: v.seed, params: Object.assign({}, v.params), w, h, scale, every: reduce.matches ? 0 : every, priority };
    if (!offThread) {
      stylePiece(v.name).then((p) => { const a = performance.now(); paint(v.canvas, p, P.solve(p, job.seed, job.params), 1); shown(job, { ms: performance.now() - a, marks: 0, frames: [] }); })
        .catch((error) => shown(job, { error: String(error.message || error) }));
      return;
    }
    const i = queue.findIndex((q) => q.v === v);
    if (i >= 0) queue.splice(i, 1);
    queue.push(job);
    next();
  }
  function shown(job, r) {
    const v = job.v, st = v.stat;
    if (v.stat === stat.page) stat.ready = true;
    if (r.error) { st.error = r.error; stat.errors.push(v.name + ': ' + r.error); say(styles[v.name].title + ' could not be drawn: ' + r.error); return; }
    st.drawn++;
    st.ms.push(Math.round(r.ms));
    Object.assign(st, { seed: job.seed, params: job.params, marks: r.marks, width: job.w });
    v.marks = r.marks;
    if (!r.image) return;
    stop(v);
    const copies = r.frames.concat(r.image), g = v.canvas.getContext('2d');
    if (v.canvas.width !== job.w || v.canvas.height !== job.h) { v.canvas.width = job.w; v.canvas.height = job.h; }
    v.copies = copies;
    // Played back over LAID_MS, the copies show the marks laid one after another; the last is the picture.
    let start = null;
    const step = (now) => {
      if (start === null) start = now;
      // A frame's time can come before the first call's clock reading, so the index never goes below 0.
      const k = copies.length === 1 ? 0 : Math.min(copies.length - 1, Math.max(0, Math.floor((now - start) / LAID_MS * copies.length)));
      g.clearRect(0, 0, job.w, job.h);
      g.drawImage(copies[k], 0, 0);
      if (k < copies.length - 1) { v.playing = requestAnimationFrame(step); return; }
      v.playing = 0;
      if (copies.length > 1) st.laid++;
      stop(v);
    };
    step(performance.now());
  }
  function stop(v) {
    cancelAnimationFrame(v.playing || 0);
    v.playing = 0;
    if (v.copies) v.copies.forEach((b) => b.close());
    v.copies = null;
  }
  // A copy every so many marks for about COPIES copies; before the count is known, every mark, and the worker
  // thins the copies to at most 48 as the draw goes on, so a draw of few marks is still laid.
  const lays = (v) => (v.marks ? Math.max(1, Math.ceil(v.marks / COPIES)) : 1);

  const cards = Array.from(document.querySelectorAll('.card[data-style]')).filter((el) => styles[el.dataset.style]).map((el) => {
    const v = { name: el.dataset.style, el, canvas: el.querySelector('canvas'), seed: data.seed, params: {}, marks: 0 };
    v.stat = stat.cards[v.name] = { tier: styles[v.name].poster ? 'poster' : 'live', drawn: 0, laid: 0, ms: [], seed: v.seed, error: null };
    // Hover or focus plays its marks laid; a press draws it at a new seed, laid.
    const lay = () => { if (!reduce.matches && v.stat.drawn && !v.playing) drawView(v, lays(v), 2); };
    el.addEventListener('pointerenter', lay);
    el.addEventListener('focusin', lay);
    el.querySelector('.art').addEventListener('click', () => {
      v.seed = nextSeed(v.seed);
      cue('roll');
      drawView(v, lays(v), 3);
      say(styles[v.name].title + ', seed ' + v.seed);
    });
    return v;
  });
  if (cards.length) {
    // Once the section nears the screen: the quick cards first, then the slow ones behind their posters; under
    // reduced motion a slow card keeps its poster until it is pressed.
    const near = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      near.disconnect();
      for (const v of cards) if (!(reduce.matches && styles[v.name].poster)) drawView(v, 0, styles[v.name].poster ? 0 : 1);
    }, { rootMargin: '300px' });
    near.observe(document.querySelector('.cards'));
    let resized = 0;
    addEventListener('resize', () => { clearTimeout(resized); resized = setTimeout(() => { for (const v of cards) if (v.stat.drawn && v.stat.width !== Math.round(v.canvas.clientWidth * Math.min(devicePixelRatio || 1, 2))) drawView(v); }, 200); });
  }

  // A style's page: its demo live at its declared parameters and a seed, its marks laid when it opens.
  if (page && styles[page.dataset.style]) {
    const s = styles[page.dataset.style], v = { name: s.name, canvas: document.getElementById('style-canvas'), seed: data.seed, params: {}, marks: 0 };
    v.stat = stat.page = { name: s.name, drawn: 0, laid: 0, ms: [], seed: v.seed, error: null };
    const out = document.getElementById('style-out'), show = () => { out.value = 'seed ' + v.seed; };
    for (const input of page.querySelectorAll('[data-param]')) {
      const spec = s.params[input.dataset.param];
      Object.assign(input, { min: spec.min, max: spec.max, step: (spec.max - spec.min) / 100, value: spec.value });
      input.addEventListener('input', () => { v.params[input.dataset.param] = Number(input.value); cue('slide'); drawView(v); });
    }
    document.getElementById('style-seed').addEventListener('click', () => { v.seed = nextSeed(v.seed); cue('roll'); show(); drawView(v, lays(v), 1); });
    show();
    drawView(v, lays(v), 1);
    let resized = 0;
    addEventListener('resize', () => { clearTimeout(resized); resized = setTimeout(() => drawView(v), 200); });
  }

  // --- install --------------------------------------------------------------------
  for (const button of document.querySelectorAll('button[data-copy]')) {
    button.addEventListener('click', () => {
      const text = document.getElementById(button.dataset.copy).textContent.trim();
      cue('tap');
      const shown = () => { const r = document.createRange(); r.selectNodeContents(document.getElementById(button.dataset.copy)); getSelection().removeAllRanges(); getSelection().addRange(r); say('copying was refused: the text is selected, copy it with your keyboard'); };
      if (!navigator.clipboard) { shown(); return; }
      navigator.clipboard.writeText(text).then(() => say('copied: ' + text.split('\n')[0] + (text.includes('\n') ? ' …' : '')), shown);
    });
  }
}());
