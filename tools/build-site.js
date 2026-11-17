#!/usr/bin/env node
'use strict';

// Build the showcase site into out/site/ from site/shots.js: index.html, the
// product page, and film.html, the film you scroll.
//
// The product page draws the pieces the shot list names under `home` (the
// hero, the teaching piece and the interface sounds). They join the module
// list after the shots and their heard pieces, so a module they share with a
// shot is defined once, and each loads its own scripts. The page shows the
// teaching piece's `// @site <name>` regions beside the widgets, and the
// install commands from the README, both cut at build time.
//
// Every shot is an ordinary piece, loaded through the external-piece loader as
// one list, so a module two shots share is defined once, in the shared-<n>.js
// that holds the modules those same shots share, and each shot's own modules
// go in its own script. The stage loads a shot's scripts as the visitor nears
// the shot. core.js is bundle(): the module runtime, the library
// modules the stage, the worker and the first shot require, and a registry
// of the shots; a library module only later shots reach is split like their
// own modules. exports.js holds core/export.js and what it reaches beyond
// core.js, even a module a shot's script also holds, since either may load
// first; the stage loads it the first time a visitor asks for a file.
// data.js is the shot data the stage reads, a same-origin script rather than
// text in the page. Nothing under a private directory is bundled or copied.
//
// `npm run site -- --serve` also serves out/site/ on loopback until stopped.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { bundle, reach, checkResolvable, wrap } = require('./build-page.js');
const { loadExternal, shown, outRoot } = require('./piece-input.js');
const { shots: cut } = require('../core/time.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(outRoot(), 'site');
const EXPORTS = 'core/export.js';
const USAGE = 'usage: npm run site [-- --serve [--port N]]';

// The public boundary: working records never reach the site, whatever links to them.
const PRIVATE = /(?:^|\/)(?:\.private|docs\/(?:tasks|decisions|knowledge\/private|apis\/private))(?:\/|$)/i;

/** Refuse a module or asset whose real path is under a private directory, naming it. */
function refusePrivate(file, what) {
  const real = fs.realpathSync(file);
  if (PRIVATE.test(real.replace(/\\/g, '/'))) {
    throw new Error('site: refusing to publish ' + what + ' ' + real + ': it is under a private directory');
  }
  return real;
}

const KEYS = ['name', 'piece', 'heard', 'seam', 'seconds', 'tier', 'still', 'poster', 'title', 'text'];
const POSTER = /\.(?:webp|png|jpe?g)$/i;

/** The shot list, checked against the pieces it names. */
function readShots(config, pieces) {
  if (!config || !Number.isFinite(config.hz) || config.hz <= 0) throw new Error('site: shots needs a positive hz');
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) throw new Error('site: shots needs a seed in [0, 2^32-1]');
  const seen = new Set();
  const list = config.shots.map((s, i) => {
    const who = 'site: shot ' + (s.name || i);
    const unknown = Object.keys(s).filter((k) => !KEYS.includes(k));
    if (unknown.length) throw new Error(who + ': unknown key(s) ' + unknown.join(', ') + '; known: ' + KEYS.join(', '));
    if (!/^[a-z][a-z0-9-]*$/.test(s.name || '')) throw new Error(who + ': name must be kebab-case');
    if (seen.has(s.name)) throw new Error(who + ': the name is used twice');
    seen.add(s.name);
    const p = pieces[i].piece;
    if (p.time && s.seconds !== undefined) throw new Error(who + ': a timed piece lasts its own duration; remove seconds');
    if (!p.time && !(Number.isFinite(s.seconds) && s.seconds > 0)) throw new Error(who + ': a still needs seconds, how long it holds');
    if (s.tier !== undefined && s.tier !== 'worker') throw new Error(who + ': tier must be "worker" or left out');
    if (s.still !== undefined && (s.seam || !(s.still >= 0 && s.still <= 1))) throw new Error(who + ': still must be a playhead in [0, 1], and a seam has none');
    if (s.poster !== undefined && !POSTER.test(s.poster)) throw new Error(who + ': poster must be a .webp, .png or .jpg image');
    for (const k of ['title', 'text']) if (s[k] !== undefined && typeof s[k] !== 'string') throw new Error(who + ': ' + k + ' must be text');
    return {
      name: s.name, seam: !!s.seam, seconds: p.time ? p.time.duration : s.seconds,
      tier: s.tier || (p.time ? 'frame' : 'change'), still: s.seam ? null : s.still ?? 1,
      title: s.title || '', text: s.text || '', poster: s.poster,
      // A piece that declares boxes: its design size and ranges, for the site check's box path.
      ...(p.boxes && { size: p.size, boxes: p.boxes }),
    };
  });
  // Resolved here as the stage resolves it, so a shot too short for a whole frame fails the build.
  let elapsed = 0;
  for (const s of list) elapsed += s.seconds;
  const frames = Math.round(elapsed * config.hz);
  cut(list.map((s) => [s.name, s.seconds]), { hz: config.hz, frames });
  return { list, frames };
}

const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function sections(list) {
  return list.map((s, i) => '<section class="shot' + (s.seam ? ' seam' : '') + '" id="shot-' + s.name + '" data-shot="' + i + '"'
    + (s.seam ? ' aria-hidden="true"' : '') + '>\n<div class="card">'
    + (s.title ? '<h2>' + escape(s.title) + '</h2>' : '') + (s.text ? '<p>' + escape(s.text) + '</p>' : '') + '</div>'
    // Without scripts the stage never runs: the shot's poster is then an image in its place, with the shot's name as its text.
    + (s.seam ? '' : '\n<figure class="still" data-shot="' + i + '">' + (s.poster ? '<noscript><img src="posters/' + s.name + path.extname(s.poster).toLowerCase() + '" alt="' + escape(s.title || s.name) + '"></noscript>' : '') + '</figure>') + '\n</section>').join('\n');
}

/** The `// @site <name>` ... `// @site end` regions of `source`, each dedented. */
function regions(source, file) {
  const out = {};
  for (const m of source.matchAll(/^([ \t]*)\/\/ @site ([a-z-]+)\n([\s\S]*?)^[ \t]*\/\/ @site end$/gm)) {
    if (m[2] === 'end') continue;
    const lines = m[3].replace(/\n$/, '').split('\n'), cut = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length));
    out[m[2]] = lines.map((l) => l.slice(cut)).join('\n');
  }
  if (!Object.keys(out).length) throw new Error('site: ' + file + ' marks no // @site region');
  return out;
}

/** The install commands of each host the README names: "With <host> installed:" and the shell block after it. */
function installs(readme) {
  const out = [...readme.matchAll(/^With (?:the )?(.+?) installed:\n\n```shell\n([\s\S]*?)```/gm)].map((m) => ({ host: m[1], lines: m[2].trim() }));
  if (!out.length) throw new Error('site: README.md names no install commands ("With <host> installed:" and a shell block)');
  return out;
}

/** The product page: index.html with the teaching piece's code and the install commands filled in. */
function homePage(template, code, hosts) {
  for (const marker of ['<!-- install -->']) if (!template.includes(marker)) throw new Error('site: index.html has no ' + marker + ' marker');
  const html = template.replace(/<!-- code:([a-z-]+) -->/g, (all, name) => {
    if (!(name in code)) throw new Error('site: index.html shows the region ' + name + ', which the teaching piece does not mark');
    return escape(code[name]);
  });
  return html.replace('<!-- install -->', () => hosts.map((h, i) => '<h3>' + escape(h.host) + '</h3>\n<pre id="install-' + i + '">' + escape(h.lines) + '</pre>\n'
    + '<button type="button" class="quiet" data-copy="install-' + i + '">Copy the ' + escape(h.host) + ' lines</button>').join('\n'));
}

function parses(name, source) {
  try { new Function(source); }  // eslint-disable-line no-new-func
  catch (error) { throw new Error('site: ' + name + ' does not parse: ' + error.message); }
  return source;
}

/**
 * Write the site. `shots` is the shot-list module, `site` the directory with
 * the page template, stage and worker, `out` the directory to replace.
 * Returns what was written and the transfer sizes.
 */
function build({ shots = path.join(SITE, 'shots.js'), site = SITE, out = OUT } = {}) {
  const file = refusePrivate(path.resolve(shots), 'shot list');
  delete require.cache[file];
  const config = require(file);
  if (!config || !Array.isArray(config.shots) || !config.shots.length) throw new Error('site: ' + shots + ' must export { hz, seed, shots: [...] }');
  const base = path.dirname(file);
  for (const s of config.shots) if (typeof s.piece !== 'string') throw new Error('site: shot ' + s.name + ' needs a piece path');
  // A shot's `heard` is the same piece with its sound, loaded apart from it: it joins the list after the shots.
  const heard = config.shots.map((s, i) => [s, i]).filter(([s]) => s.heard !== undefined);
  for (const [s] of heard) if (typeof s.heard !== 'string') throw new Error('site: shot ' + s.name + ': heard must be a piece path');
  // The product page's pieces, `home: { hero, teach, ui }`, join the list after those.
  const homes = Object.entries(config.home || {});
  for (const [name, p] of homes) if (!['hero', 'teach', 'ui'].includes(name) || typeof p !== 'string') throw new Error('site: home.' + name + ': home names hero, teach and ui, each a piece path');
  if (homes.length && homes.length !== 3) throw new Error('site: home needs hero, teach and ui, or nothing');
  const external = loadExternal(config.shots.map((s) => s.piece).concat(heard.map(([s]) => s.heard), homes.map(([, p]) => p)), base);
  for (const m of external.modules) refusePrivate(m.real, 'module');
  const { list, frames } = readShots(config, external.pieces);
  heard.forEach(([s], n) => { if (typeof external.pieces[config.shots.length + n].piece.sound !== 'function') throw new Error('site: shot ' + s.name + ': its heard piece has no sound'); });

  // core.js holds the library modules the stage, the worker and the first shot
  // require, and what those reach; a library module only later shots reach
  // goes with their modules below.
  const read = (name) => fs.readFileSync(refusePrivate(path.join(site, name), 'site file'), 'utf8');
  const runtime = ['stage.js', 'worker.js', ...(homes.length ? ['home.js', 'theme.js'] : [])].map((name) => [name, read(name)]);
  const needs = runtime.flatMap(([, text]) => [...text.matchAll(/\breq\('([^']+)'\)/g)].map((m) => m[1]));
  const core = reach(needs.concat(external.pieces[0].library)), exported = reach(needs.concat(EXPORTS));
  const reaches = external.pieces.map((p) => p.modules.concat(reach(p.library).filter((id) => !core.includes(id))));

  // Modules reached by the same two or more shots go in one shared-<n>.js,
  // numbered in order of the first shot that needs them; the rest in the
  // shot's own script. A shot loads only the shared scripts it reaches.
  const users = new Map();
  reaches.forEach((ids, i) => { for (const id of ids) users.set(id, (users.get(id) || []).concat(i)); });
  // A heard piece loads after its shot, so what the shot already loads is not shared with it.
  heard.forEach(([, at], n) => { for (const [id, shots] of users) if (shots.includes(at)) users.set(id, shots.filter((i) => i !== config.shots.length + n)); });
  const files = new Map();
  const chunk = (name, ids) => {
    const source = external.modules.filter((m) => ids.includes(m.id)).map((m) => m.source)
      .concat(ids.filter((id) => !id.startsWith('external/')).map(wrap)).join('\n');
    if (source) files.set(name, parses(name, source));
    return source ? [name] : [];
  };
  const groups = new Map();
  for (const [id, shots] of users) if (shots.length > 1) groups.set(shots.join(','), (groups.get(shots.join(',')) || []).concat(id));
  const shared = [...groups].sort(([a], [b]) => a.split(',')[0] - b.split(',')[0] || (a < b ? -1 : 1))
    .map(([key, ids], n) => ({ shots: key.split(',').map(Number), name: chunk('shared-' + (n + 1) + '.js', ids)[0] }));
  const posters = new Map();
  const data = {
    hz: config.hz, seed: config.seed, frames, exports: { script: 'exports.js', module: EXPORTS },
    shots: list.map((s, i) => {
      const scripts = shared.filter((c) => c.shots.includes(i)).map((c) => c.name)
        .concat(chunk('shot-' + s.name + '.js', reaches[i].filter((id) => users.get(id).length === 1)));
      let poster = null;
      if (s.poster) {
        const file = refusePrivate(path.resolve(base, s.poster), 'asset');
        poster = 'posters/' + s.name + path.extname(file).toLowerCase();
        posters.set(poster, file);
      }
      // What its heard piece reaches beyond the shot's own scripts, shared scripts first.
      const h = heard.findIndex(([, at]) => at === i), late = list.length + h;
      const sound = h < 0 ? null : { id: external.pieces[late].id, scripts: shared.filter((c) => c.shots.includes(late)).map((c) => c.name).filter((f) => !scripts.includes(f))
        .concat(chunk('heard-' + s.name + '.js', reaches[late].filter((id) => users.get(id).length === 1))) };
      return { name: s.name, id: external.pieces[i].id, scripts, ...(sound && { heard: sound }), seam: s.seam, seconds: s.seconds, tier: s.tier, still: s.still, poster, label: s.title || s.name, ...(s.boxes && { size: s.size, boxes: s.boxes }) };
    }),
  };
  // Each product page piece: the shared scripts it reaches, then its own.
  const at = config.shots.length + heard.length;
  if (homes.length) {
    data.home = Object.fromEntries(homes.map(([name], n) => [name, { id: external.pieces[at + n].id,
      scripts: shared.filter((c) => c.shots.includes(at + n)).map((c) => c.name).concat(chunk('home-' + name + '.js', reaches[at + n].filter((id) => users.get(id).length === 1))) }]));
  }

  const template = read('film.html');
  for (const marker of ['<!-- shots -->', '<!-- data -->']) {
    if (!template.includes(marker)) throw new Error('site: ' + path.join(site, 'film.html') + ' has no ' + marker + ' marker');
  }
  files.set('film.html', template.replace('<!-- shots -->', () => sections(list))
    .replace('<!-- data -->', () => '<script src="data.js"></script>'));
  if (homes.length) {
    const teach = refusePrivate(path.resolve(base, config.home.teach), 'module');
    files.set('index.html', homePage(read('index.html'), regions(fs.readFileSync(teach, 'utf8'), teach), installs(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'))));
    files.set('home.css', read('home.css'));
  }
  files.set('data.js', 'window.__siteData = ' + JSON.stringify(data) + ';\n');
  files.set('core.js', parses('core.js', bundle({ source: external.registry }, core)));
  checkResolvable(exported);
  files.set('exports.js', parses('exports.js', exported.filter((id) => !core.includes(id)).map(wrap).join('\n')));
  for (const [name, text] of runtime) files.set(name, parses(name, text));
  files.set('site.css', read('site.css'));

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, posters.size ? 'posters' : ''), { recursive: true });
  for (const [name, text] of files) fs.writeFileSync(path.join(out, name), text);
  for (const [name, file] of posters) fs.copyFileSync(file, path.join(out, name));

  const brotli = (name) => zlib.brotliCompressSync(fs.readFileSync(path.join(out, name))).length;
  const sizes = Object.fromEntries([...files.keys(), ...posters.keys()].map((name) => [name, brotli(name)]));
  // What a visitor loads before the film's first shot draws, and before the product page's hero does.
  const sum = (names) => names.reduce((total, name) => total + sizes[name], 0);
  const filmLoad = sum(['film.html', 'data.js', 'site.css', 'core.js', 'stage.js', ...data.shots[0].scripts, ...(data.shots[0].poster ? [data.shots[0].poster] : [])]);
  return {
    out, data, files: Object.keys(sizes), sizes, filmLoad,
    // The landing page's: the product page's when there is one.
    firstLoad: data.home ? sum(['index.html', 'theme.js', 'home.css', 'data.js', 'core.js', 'home.js', ...data.home.hero.scripts]) : filmLoad,
    total: Object.values(sizes).reduce((a, b) => a + b, 0),
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** Serve the files under `dir` on an OS-assigned (or given) loopback port, nothing outside it. */
async function serveSite(dir = OUT, port = 0) {
  const root = fs.realpathSync(dir);
  const server = http.createServer((request, response) => {
    let file, found = false;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
      found = !path.relative(root, file).startsWith('..') && !!fs.statSync(file, { throwIfNoEntry: false })?.isFile();
    } catch { response.writeHead(400).end(); return; }
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!['GET', 'HEAD'].includes(request.method) || !type || !found) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/',
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const refuse = (cause) => new Error('site: ' + cause + '\n' + USAGE);
  let serve = false, port = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--serve') serve = true;
    else if (args[i] === '--port') {
      if (!/^\d+$/.test(args[i + 1] || '') || Number(args[i + 1]) > 65535) throw refuse('--port needs a port number from 0 to 65535, got ' + (args[i + 1] ?? 'nothing'));
      port = Number(args[++i]);
    }
    else throw refuse('unknown option ' + args[i]);
  }
  const result = build();
  const kb = (b) => (b / 1024).toFixed(1) + ' kB';
  console.log(shown(result.out, ROOT) + '  ' + result.data.shots.length + ' shots, ' + result.data.frames + ' frames at ' + result.data.hz + ' Hz, '
    + result.files.length + ' files; brotli: first load ' + kb(result.firstLoad) + (result.data.home ? ' (product page; the film ' + kb(result.filmLoad) + ')' : '') + ', whole site ' + kb(result.total));
  if (!serve) return;
  const server = await serveSite(result.out, port);
  console.log('serving ' + server.url + ' on loopback; stop with Ctrl+C');
  process.once('SIGINT', () => server.close().then(() => process.exit(0)));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { build, serveSite, refusePrivate, readShots, regions, installs, main, OUT, PRIVATE };
