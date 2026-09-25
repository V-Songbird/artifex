#!/usr/bin/env node
'use strict';

// Build the showcase site into out/site/ from site/shots.js.
//
// Every shot is an ordinary piece, loaded through the external-piece loader as
// one list, so a module two shots share is defined once, in shared.js, and
// each shot's own modules go in its own script, which the stage loads as the
// visitor nears the shot. core.js is bundle(): the module runtime and the
// library. data.js is the shot data the stage reads, a same-origin script
// rather than text in the page. Nothing under a private directory is bundled or
// copied.
//
// `npm run site -- --serve` also serves out/site/ on loopback until stopped.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { bundle } = require('./build-page.js');
const { loadExternal } = require('./piece-input.js');
const { shots: cut } = require('../core/time.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'out', 'site');
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

const KEYS = ['name', 'piece', 'seam', 'seconds', 'tier', 'still', 'poster', 'title', 'text'];
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
    + (s.seam ? '' : '\n<figure class="still" data-shot="' + i + '"></figure>') + '\n</section>').join('\n');
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
  const external = loadExternal(config.shots.map((s) => s.piece), base);
  for (const m of external.modules) refusePrivate(m.file, 'module');
  const { list, frames } = readShots(config, external.pieces);

  // A module reached by two shots goes in shared.js; the rest in its shot's own script.
  const users = new Map();
  for (const p of external.pieces) for (const id of p.modules) users.set(id, (users.get(id) || 0) + 1);
  const files = new Map();
  const chunk = (name, ids) => {
    const source = external.modules.filter((m) => ids.includes(m.id)).map((m) => m.source).join('\n');
    if (source) files.set(name, parses(name, source));
    return source ? [name] : [];
  };
  const shared = [...users].filter(([, n]) => n > 1).map(([id]) => id);
  chunk('shared.js', shared);
  const posters = new Map();
  const data = {
    hz: config.hz, seed: config.seed, frames,
    shots: list.map((s, i) => {
      const reach = external.pieces[i].modules;
      const scripts = (reach.some((id) => shared.includes(id)) ? ['shared.js'] : [])
        .concat(chunk('shot-' + s.name + '.js', reach.filter((id) => !shared.includes(id))));
      let poster = null;
      if (s.poster) {
        const file = refusePrivate(path.resolve(base, s.poster), 'asset');
        poster = 'posters/' + s.name + path.extname(file).toLowerCase();
        posters.set(poster, file);
      }
      return { name: s.name, id: external.pieces[i].id, scripts, seam: s.seam, seconds: s.seconds, tier: s.tier, still: s.still, poster, label: s.title || s.name };
    }),
  };

  const read = (name) => fs.readFileSync(refusePrivate(path.join(site, name), 'site file'), 'utf8');
  const template = read('index.html');
  for (const marker of ['<!-- shots -->', '<!-- data -->']) {
    if (!template.includes(marker)) throw new Error('site: ' + path.join(site, 'index.html') + ' has no ' + marker + ' marker');
  }
  files.set('index.html', template.replace('<!-- shots -->', () => sections(list))
    .replace('<!-- data -->', () => '<script src="data.js"></script>'));
  files.set('data.js', 'window.__siteData = ' + JSON.stringify(data) + ';\n');
  files.set('core.js', parses('core.js', bundle()));
  for (const name of ['stage.js', 'worker.js']) files.set(name, parses(name, read(name)));
  files.set('site.css', read('site.css'));

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, posters.size ? 'posters' : ''), { recursive: true });
  for (const [name, text] of files) fs.writeFileSync(path.join(out, name), text);
  for (const [name, file] of posters) fs.copyFileSync(file, path.join(out, name));

  const brotli = (name) => zlib.brotliCompressSync(fs.readFileSync(path.join(out, name))).length;
  const sizes = Object.fromEntries([...files.keys(), ...posters.keys()].map((name) => [name, brotli(name)]));
  // What a visitor loads before the first shot draws.
  const first = ['index.html', 'data.js', 'site.css', 'core.js', 'stage.js', ...data.shots[0].scripts, ...(data.shots[0].poster ? [data.shots[0].poster] : [])];
  return {
    out, data, files: Object.keys(sizes), sizes,
    firstLoad: first.reduce((sum, name) => sum + sizes[name], 0),
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
  let serve = false, port = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--serve') serve = true;
    else if (args[i] === '--port' && /^\d+$/.test(args[i + 1] || '') && Number(args[i + 1]) < 65536) port = Number(args[++i]);
    else throw new Error(USAGE);
  }
  const result = build();
  const kb = (b) => (b / 1024).toFixed(1) + ' kB';
  console.log(path.relative(ROOT, result.out) + '  ' + result.data.shots.length + ' shots, ' + result.data.frames + ' frames at ' + result.data.hz + ' Hz, '
    + result.files.length + ' files; brotli: first load ' + kb(result.firstLoad) + ', whole site ' + kb(result.total));
  if (!serve) return;
  const server = await serveSite(result.out, port);
  console.log('serving ' + server.url + ' on loopback; stop with Ctrl+C');
  process.once('SIGINT', () => server.close().then(() => process.exit(0)));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { build, serveSite, refusePrivate, readShots, main, OUT, PRIVATE };
