'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire, isBuiltin } = require('node:module');
const { validate } = require('../core/piece.js');

const ROOT = path.resolve(__dirname, '..');
const CORE = fs.readdirSync(path.join(ROOT, 'core')).filter((f) => f.endsWith('.js'));
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function callerDirectory(cwd = process.cwd(), env = process.env) {
  // npm run changes cwd to the package selected by --prefix. INIT_CWD belongs
  // to that invocation; do not let an unrelated/stale environment override node.
  const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  return ['page', 'seeds', 'replay'].includes(env.npm_lifecycle_event) && env.npm_package_json && env.INIT_CWD
    && samePath(path.resolve(env.npm_package_json), path.join(ROOT, 'package.json'))
    ? path.resolve(env.INIT_CWD) : cwd;
}

function isPiecePath(value) {
  return path.isAbsolute(value) || /[\\/]/.test(value) || /\.(?:c?js|json)$/i.test(value);
}

function outputStem(file) {
  return path.basename(file, path.extname(file)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '') || 'piece';
}

// Read direct literal CommonJS imports without treating comments or ordinary
// strings as imports. Dynamic requires cannot be made self-contained reliably.
function imports(source, file) {
  const found = [];
  const controlOpenings = new Set(), parentheses = [];
  let expressionStart = true;
  const quotedEnd = (start) => {
    const quote = source[start];
    let at = start + 1;
    for (; at < source.length; at++) {
      if (source[at] === '\\') { at++; continue; }
      if (source[at] === quote) return at + 1;
    }
    throw new Error('piece: unterminated string in ' + file);
  };
  const skipTrivia = (start) => {
    let at = start;
    while (at < source.length) {
      if (/\s/.test(source[at])) { at++; continue; }
      if (source.startsWith('//', at)) { const end = source.indexOf('\n', at); at = end < 0 ? source.length : end; continue; }
      if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); at = end < 0 ? source.length : end + 2; continue; }
      break;
    }
    return at;
  };
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith('//', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
    if ('\'"`'.includes(source[i])) {
      const end = quotedEnd(i);
      if (source[i] === '`' && /<\/script/i.test(source.slice(i, end))) {
        throw new Error('piece: template literals containing script-end text are unsupported in ' + file + '; use an ordinary quoted string or JSON');
      }
      if (source[i] === '`' && source.slice(i, end).includes('${') && /\brequire\s*\(/.test(source.slice(i, end))) {
        throw new Error('piece: move require calls outside template literals in ' + file);
      }
      i = end; expressionStart = false; continue;
    }
    if (source[i] === '/' && expressionStart) {
      let inClass = false;
      for (i++; i < source.length; i++) {
        if (source[i] === '\\') { i++; continue; }
        if (source[i] === '[') inClass = true;
        if (source[i] === ']') inClass = false;
        if (source[i] === '/' && !inClass) { i++; break; }
      }
      while (/[a-z]/i.test(source[i] || ' ')) i++;
      expressionStart = false; continue;
    }
    if (source.startsWith('import', i) && !/[\w$.]/.test(source[i - 1] || '') && /^import\s*\(/.test(source.slice(i))) {
      throw new Error('piece: dynamic import is not supported in ' + file);
    }
    if (source.startsWith('require', i) && !/[\w$.]/.test(source[i - 1] || '') && !/[\w$]/.test(source[i + 7] || '')) {
      const open = skipTrivia(i + 7);
      if (source[open] === ':') { i += 7; expressionStart = false; continue; }
      if (source[open] === '(') {
        const start = skipTrivia(open + 1);
        if (!'\'"'.includes(source[start] || ' ')) throw new Error('piece: require needs a literal module path in ' + file);
        const end = quotedEnd(start);
        const close = skipTrivia(end);
        if (source[close] !== ')') throw new Error('piece: require needs one literal module path in ' + file);
        const spec = new Function('return ' + source.slice(start, end))();
        found.push({ start: i, end: close + 1, spec });
        i = close + 1; expressionStart = false; continue;
      }
      throw new Error('piece: use direct literal require calls instead of aliases in ' + file);
    }
    const word = /^(?:[$_\p{ID_Start}]|\\u(?:\{[\da-f]+\}|[\da-f]{4}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:\{[\da-f]+\}|[\da-f]{4}))*/iu.exec(source.slice(i));
    if (word) {
      const next = skipTrivia(i + word[0].length);
      if (/^(if|while|for|with|switch|catch)$/.test(word[0]) && source[next] === '(') controlOpenings.add(next);
      expressionStart = /^(return|throw|case|delete|void|typeof|new|in|instanceof|yield|await)$/.test(word[0]);
      i += word[0].length; continue;
    }
    if (source[i] === '(') { parentheses.push(controlOpenings.has(i)); expressionStart = true; i++; continue; }
    if (source[i] === ')') { expressionStart = parentheses.pop() === true; i++; continue; }
    expressionStart = !/[\w)\].]/.test(source[i]);
    i++;
  }
  return found;
}

// `input` is one piece path, or a list of them. A list shares one module table,
// so a helper two pieces require is defined once, and says which modules each
// piece reaches, so a caller can split the definitions per piece, and which
// library modules the pieces require, so a caller can bundle only those.
// `require('artifex/core/<file>.js')` names a library core module from any folder.
// `confine: { root, files }` refuses every piece and require other than those
// files (paths relative to root, forward slashes) and artifex/core modules.
// Node runs the pieces from the same module table and sources the page gets.
function loadExternal(input, cwd = callerDirectory(), { confine } = {}) {
  const list = Array.isArray(input);
  if (list && !input.length) throw new Error('piece: loadExternal needs at least one piece');
  const ids = new Map(), modules = [], requires = new Map(), library = new Set(), table = new Map();
  const root = confine && fs.realpathSync(path.resolve(cwd, confine.root));
  const files = confine && new Set(confine.files);
  const listed = (file) => files.has(path.relative(root, file).split(path.sep).join('/'));
  const outside = (file, spec) => new Error('piece: ' + file + ' requires ' + spec + ', which is not a listed file of ' + root + ' or artifex/core/<file>.js');
  function visit(file) {
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    if (/^(core|examples)\/[^/]+\.js$/.test(relative)) { library.add(relative); return relative; }
    if (ids.has(file)) return ids.get(file);
    const extension = path.extname(file).toLowerCase();
    if (!['.js', '.cjs', '.json'].includes(extension)) throw new Error('piece: browser bundles support CommonJS .js/.cjs and .json, not ' + file);
    const id = 'external/' + ids.size + '.js';
    ids.set(file, id);
    let source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/^#![^\n]*/, '');
    requires.set(id, []);
    if (extension === '.json') {
      let data;
      try { data = JSON.parse(source); }
      catch (error) { throw new SyntaxError('piece: invalid JSON in ' + file + ': ' + error.message, { cause: error }); }
      source = 'module.exports = JSON.parse(' + json(JSON.stringify(data)) + ');';
    }
    else {
      try { new Function('module', 'exports', 'require', source); }
      catch (error) { throw new Error('piece: expected browser-compatible CommonJS in ' + file + ': ' + error.message); }
      const localRequire = createRequire(file);
      const dependencies = imports(source, file);
      for (const dependency of dependencies) {
        if (isBuiltin(dependency.spec)) throw new Error('piece: Node builtin ' + dependency.spec + ' cannot run in the browser (' + file + ')');
        const core = /^artifex\/core\/([^/\\]+)$/.exec(dependency.spec);
        let resolved;
        if (core) {
          if (!CORE.includes(core[1])) throw new Error('piece: cannot resolve ' + dependency.spec + ' from ' + file + ': core/ has no module ' + core[1]);
          resolved = path.join(ROOT, 'core', core[1]);
        }
        else {
          if (confine && dependency.spec[0] !== '.') throw outside(file, dependency.spec);
          try { resolved = localRequire.resolve(dependency.spec); }
          catch (error) { throw new Error('piece: cannot resolve ' + dependency.spec + ' from ' + file + ': ' + error.message); }
          if (confine && !listed(resolved)) throw outside(file, dependency.spec + ' (' + resolved + ')');
        }
        dependency.id = visit(resolved);
        if (dependency.id.startsWith('external/')) requires.get(id).push(dependency.id);
      }
      for (const dependency of dependencies.reverse()) {
        source = source.slice(0, dependency.start) + 'require(' + json(dependency.id) + ')' + source.slice(dependency.end);
      }
    }
    // A string containing an HTML end tag is legitimate piece data. Escaping
    // its slash preserves the JS string value without ending the script tag.
    source = source.replace(/<\/script/gi, (marker) => '<\\/' + marker.slice(2));
    source = '__def(' + json(id) + ', function (module, exports, require) {\n' + source + '\n});';
    modules.push({ id, file, source });
    // The same text the page runs, compiled here so Node defines the module as the page does.
    vm.runInThisContext('(function (__def) {' + source + '\n})', { filename: file, lineOffset: -1 })((key, fn) => table.set(key, fn));
    return id;
  }
  // The page's require over the same table: library modules are the files the page bundles.
  const cache = new Map();
  function run(id) {
    if (!table.has(id)) return require(path.join(ROOT, id));
    if (!cache.has(id)) { const m = { exports: {} }; cache.set(id, m); table.get(id)(m, m.exports, run); }
    return cache.get(id).exports;
  }
  // Every module a piece reaches, itself first, each once.
  function reach(id, found = new Set()) {
    if (!found.has(id)) { found.add(id); for (const next of requires.get(id)) reach(next, found); }
    return found;
  }
  const pieces = [], byName = new Map();
  for (const one of list ? input : [input]) {
    let entry;
    try { entry = require.resolve(path.resolve(cwd, one)); }
    catch (error) { throw new Error('piece: cannot load ' + path.resolve(cwd, one) + ': ' + error.message); }
    if (confine && !listed(entry)) throw new Error('piece: ' + entry + ' is not a listed file of ' + root);
    const id = visit(entry);
    let piece;
    try { piece = validate(run(id)); }
    catch (error) { throw new Error('piece: invalid module ' + entry + ': ' + error.message); }
    // One registry name per piece: a second module under the same name would replace the first.
    const named = byName.get(piece.name);
    if (named && named.entry !== entry) throw new Error('piece: ' + named.entry + ' and ' + entry + ' are both named ' + piece.name);
    byName.set(piece.name, { entry, id });
    pieces.push({ entry, id, piece, modules: [...reach(id)] });
  }
  const names = [...byName.keys()];
  const registry = "__def('examples/index.js', function (module, exports, require) {\n"
    + 'module.exports = Object.create(null);\n'
    + names.map((name) => 'module.exports[' + json(name) + '] = require(' + json(byName.get(name).id) + ');\n').join('')
    + '});';
  const source = modules.map((m) => m.source).concat(registry).join('\n');
  if (list) return { pieces, names, source, moduleCount: ids.size, modules, library: [...library], registry };
  const [{ entry, piece }] = pieces;
  return { entry, piece, names, source, moduleCount: ids.size, stem: outputStem(entry), directory: path.dirname(entry) };
}

module.exports = { callerDirectory, isPiecePath, outputStem, loadExternal };
