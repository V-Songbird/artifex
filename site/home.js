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
  piece('hero').then((p) => {
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
