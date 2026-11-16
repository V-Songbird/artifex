'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createRequire, isBuiltin } = require('node:module');
const { validate } = require('../core/piece.js');
const { lineEnd, quotedEnd, templateEnd, regexEnd, regexAfter, keywordsIn, memberDot, memberName, numberEnd } = require('./js-comments.js');

const ROOT = path.resolve(__dirname, '..');
const CORE = fs.readdirSync(path.join(ROOT, 'core')).filter((f) => f.endsWith('.js'));
const SCRIPTS = require('../package.json').scripts;
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function callerDirectory(cwd = process.cwd(), env = process.env) {
  // npm run changes cwd to the package selected by --prefix. INIT_CWD belongs
  // to that invocation; do not let an unrelated/stale environment override node.
  // Every package.json script that runs a library tool counts, so a new one needs no edit here,
  // except the test runner: its test children inherit this env and spawn tools with their own cwd.
  const samePath = (a, b) => fold(a) === fold(b);
  return /^node tools\/(?!run-tests\.js)/.test(SCRIPTS[env.npm_lifecycle_event]) && env.npm_package_json && env.INIT_CWD
    && samePath(path.resolve(env.npm_package_json), path.join(ROOT, 'package.json'))
    ? path.resolve(env.INIT_CWD) : cwd;
}

function isPiecePath(value) {
  return path.isAbsolute(value) || /[\\/]/.test(value) || /\.(?:c?js|json)$/i.test(value);
}

function outputStem(file) {
  return path.basename(file, path.extname(file)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '') || 'piece';
}

// Windows volumes ignore case, and so do macOS default ones (an assumption: a case-sensitive macOS volume
// would match a miscased path wrongly); elsewhere paths compare exactly. `platform` is a parameter for tests.
const fold = (text, platform = process.platform) => platform === 'win32' || platform === 'darwin' ? text.toLowerCase() : text;

/** `target`'s path relative to the library root in the target's own spelling, or null when it lies outside the library. */
function inLibrary(target, platform) {
  const full = path.resolve(target);
  const within = path.relative(fold(ROOT, platform), fold(full, platform));
  return path.isAbsolute(within) || within === '..' || within.startsWith('..' + path.sep) ? null : full.slice(full.length - within.length);
}

/** `file`'s real path on disk (its own case, links followed), or `file` itself when it cannot be resolved, such as a missing file. */
function realPath(file) {
  try { return fs.realpathSync.native(file); } catch { return file; }
}

/** `file` with forward slashes (Node accepts them on Windows), so a path pasted unquoted into Git Bash keeps its separators. */
const slash = (file) => file.split(path.sep).join('/');

// What `quote` prints for a path no quoting reads the same in bash and PowerShell, and the clause `hint` adds for it.
const BY_HAND = '"<path>"';
const BY_HAND_NOTE = ' # replace "<path>" with the path, quoted by hand: it holds a single quote and a $, a !, a backtick, a backslash or a double quote, straight or curly';

/**
 * `text` as one shell argument, the same in bash and PowerShell: double-quoted, or single-quoted
 * when it holds a `$`, a `!` (bash expands it inside double quotes), a backtick, a `\` (bash reads
 * `\\` and a closing `\"` as escapes there) or a `"`, which both shells read literally in single quotes.
 * PowerShell also reads the curly double quotes U+201C to U+201E as a `"` and the curly single
 * quotes U+2018 to U+201B as a `'`. Text holding a single quote too has no such form, so it comes
 * back as the placeholder `"<path>"`, which `hint` explains.
 */
function quoteWord(text) {
  if (!/[$!`"\\“-„]/.test(text)) return `"${text}"`;
  return /['‘-‛]/.test(text) ? BY_HAND : `'${text}'`;
}

/** `file` as one shell argument, with forward slashes, so a path holding a space pastes whole; see `quoteWord`. */
const quote = (file) => quoteWord(slash(file));

/**
 * A command a tool prints for a next step, as `npm --prefix "<library root>" run <tool> -- <args>`:
 * it runs as printed from any folder. `args` are words already shell-ready, a path through
 * `quote` and a placeholder such as `"<s,s,...>"` quoted so a shell reads no redirection;
 * an empty one is left out. When `quote` could not make a path paste-safe, one trailing comment
 * says so, which both shells ignore.
 */
const hint = (tool, ...args) => ['npm', '--prefix', quote(ROOT), 'run', tool, '--', ...args].filter(Boolean).join(' ')
  + (args.some((arg) => arg.includes(BY_HAND)) || quote(ROOT) === BY_HAND ? BY_HAND_NOTE : '');

/**
 * `target` as a command prints it, with forward slashes: relative to `base`
 * when one is given, else from the library root when inside it, else in full.
 */
function shown(target, base = null) {
  return slash(base !== null ? path.relative(base, target) : inLibrary(target) ?? target);
}

/** True when `directory` is out/ or a folder Git ignores, so it holds no tracked file. */
function untracked(directory, within) {
  return fold(within).split(path.sep)[0] === 'out'
    || spawnSync('git', ['check-ignore', '-q', directory], { cwd: ROOT, stdio: 'ignore' }).status === 0;
}

/**
 * The out/ folder a command run from `cwd` writes to: the library's own when
 * `cwd` is inside the library (a clone), else `cwd`'s. An installed plugin is
 * a copy its host replaces on update, so no output may land inside it.
 */
function outRoot(cwd = callerDirectory()) {
  return path.join(inLibrary(cwd) === null ? cwd : ROOT, 'out');
}

/**
 * The folder a command writes `external`'s files to: out/ (see outRoot) for a
 * registered example, beside an external piece, and under
 * out/pieces/<its folder>/ for a piece in a tracked folder of the library,
 * such as a test fixture, so no output lands in a tracked folder. A piece
 * in a folder under out/ or in a folder Git ignores writes beside itself; one
 * at the top of out/ writes to out/pieces/, so it never replaces a registered
 * example's output.
 */
function outputDirectory(external, cwd = callerDirectory()) {
  if (!external) return outRoot(cwd);
  const within = inLibrary(external.directory);
  if (within === null) return external.directory;
  if (fold(within) === 'out') return path.join(outRoot(cwd), 'pieces');
  return untracked(external.directory, within) ? external.directory : path.join(outRoot(cwd), 'pieces', within);
}

/**
 * The piece a command names and where its file goes: `{ name, external, file }`.
 * `options` holds `piece`, `style` and `out`; `refuse(cause)` makes the
 * command's own error and `extension` (with its dot) ends the default file.
 * `--style` is refused with where the style's guide and mark functions are,
 * since a style draws nothing. A registered example writes under out/ (the
 * library's from inside it, else `cwd`'s; see outRoot), an external piece
 * beside its module and one in a tracked folder of the library under
 * out/pieces/<its folder>/; one at the top of out/ also writes to out/pieces/
 * (see outputDirectory). `--out` names the file, relative to `cwd`.
 * Without `--out`, a `--seed` joins the name as `-seed<n>`, as npm run seeds
 * names a strip, so a file at another seed never replaces the piece's own.
 */
function resolvePiece(options, cwd, refuse, extension) {
  const EXAMPLES = require('../examples/index.js');
  let external = null, name = options.piece;
  if (options.style) throw refuse(require('./styles.js').styleCause(options.style));
  if (isPiecePath(name)) external = loadExternal(name, cwd);
  else if (!Object.hasOwn(EXAMPLES, name)) throw refuse(`no example called "${name}". Known: ${Object.keys(EXAMPLES).join(', ')}. ${require('./styles.js').pieceHint(name)}`);
  if (external) name = external.names[0];
  const file = options.out !== null ? path.resolve(cwd, options.out)
    : path.join(outputDirectory(external, cwd), (external ? external.stem : name) + (options.seed != null ? '-seed' + options.seed : '') + extension);
  return { name, external, file };
}

// Read direct literal CommonJS imports without treating comments or ordinary
// strings as imports. Dynamic requires cannot be made self-contained reliably.
function imports(source, file) {
  const found = [];
  const controlOpenings = new Set(), parentheses = [];
  const keywords = keywordsIn(source);
  let expressionStart = true;
  // Past the closing quote. A quoted string left open stops at a CR or LF, as
  // the shared scanner reads it, or refuses when `strict`; one left open at the
  // end of the source always refuses. A template's `${…}` is followed.
  const pastQuote = (start, strict) => {
    const end = source[start] === '`' ? templateEnd(source, start, keywords) : quotedEnd(source, start);
    if (source[end] === source[start]) return end + 1;
    if (strict || end >= source.length) throw new Error('piece: unterminated string in ' + file);
    return end;
  };
  const skipTrivia = (start) => {
    let at = start;
    while (at < source.length) {
      if (/\s/.test(source[at])) { at++; continue; }
      if (source.startsWith('//', at)) { at = lineEnd(source, at); continue; }
      if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); at = end < 0 ? source.length : end + 2; continue; }
      break;
    }
    return at;
  };
  let lineBreak = false; // a line terminator since the last token, in whitespace or a comment
  let held = null; // the last code character before that whitespace or comment
  let numberDot = -1; // the `.` that ended the last numeric literal ending in one
  for (let i = 0; i < source.length;) {
    const after = skipTrivia(i);
    if (after > i) { lineBreak ||= /[\n\r\p{Zl}\p{Zp}]/u.test(source.slice(i, after)); held = i - 1; i = after; continue; }
    const broken = lineBreak, gap = held ?? i - 1; // the last code character before this token
    lineBreak = false; held = null;
    // A ++ or -- right after an operand on the same line is postfix, so a slash after it divides.
    if (!expressionStart && !broken && (source.startsWith('++', i) || source.startsWith('--', i))) { i += 2; continue; }
    if ('\'"`'.includes(source[i])) {
      const end = pastQuote(i);
      if (source[i] === '`' && /<\/script/i.test(source.slice(i, end))) {
        throw new Error('piece: template literals containing script-end text are unsupported in ' + file + '; use an ordinary quoted string or JSON');
      }
      if (source[i] === '`' && source.slice(i, end).includes('${') && /\brequire\s*\(/.test(source.slice(i, end))) {
        throw new Error('piece: move require calls outside template literals in ' + file);
      }
      i = end; expressionStart = false; continue;
    }
    if (source[i] === '/' && expressionStart) {
      // A regular expression stops at its line terminator, as the shared scanner reads it.
      i = regexEnd(source, i);
      if (source[i] === '/') i++;
      while (/[a-z]/i.test(source[i] || ' ')) i++;
      expressionStart = false; continue;
    }
    if (source.startsWith('import', i) && !/[\w$]/.test(source[i - 1] || '') && !memberName(source, gap, numberDot) && /^import\s*\(/.test(source.slice(i))) {
      throw new Error('piece: dynamic import is not supported in ' + file);
    }
    if (source.startsWith('require', i) && !/[\w$]/.test(source[i - 1] || '') && !memberName(source, gap, numberDot) && !/[\w$]/.test(source[i + 7] || '')) {
      const open = skipTrivia(i + 7);
      if (source[open] === ':') { i += 7; expressionStart = false; continue; }
      if (source[open] === '(') {
        const start = skipTrivia(open + 1);
        if (!'\'"'.includes(source[start] || ' ')) throw new Error('piece: require needs a literal module path in ' + file);
        const end = pastQuote(start, true);
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
      const next = skipTrivia(i + word[0].length), member = memberName(source, gap, numberDot);
      if (!member && /^(if|while|for|with|switch|catch)$/.test(word[0]) && source[next] === '(') controlOpenings.add(next);
      if (!member && word[0] === 'for' &&/^await(?![\w$])/.test(source.slice(next, next + 6))) controlOpenings.add(skipTrivia(next + 5)); // for await (
      expressionStart = regexAfter(source, i + word[0].length, parentheses[parentheses.length - 1] === true, keywords, gap, numberDot);
      i += word[0].length; continue;
    }
    if (source[i] === '(') { parentheses.push(controlOpenings.has(i)); expressionStart = true; i++; continue; }
    if (source[i] === ')') { expressionStart = parentheses.pop() === true; i++; continue; }
    const number = numberEnd(source, i);
    if (number > i) { if (source[number - 1] === '.') numberDot = number - 1; i = number; expressionStart = false; continue; }
    // A slash after a `.` divides unless the `.` ends a spread `...`: memberDot() is true for every other
    // `.`, a number's decimal point included (an operand has ended there either way); only memberName()
    // tells a member access from the `.` that ends a number.
    expressionStart = !/[\w)\]]/.test(source[i]) && !memberDot(source, i);
    i++;
  }
  return found;
}

// `input` is one piece path, or a list of them. A list shares one module table,
// so a helper two pieces require is defined once, and says which modules each
// piece reaches, so a caller can split the definitions per piece, and which
// library modules the pieces require, all together and each piece's own
// (`library`), so a caller can bundle only those.
// `require('artifex/core/<file>.js')` names a library core module from any folder,
// and `require('artifex/styles/<file>.js')` a built-in style's marks, bundled
// as the piece's own module.
// `confine: { root, files }` refuses every piece and require other than those
// files (paths relative to root, forward slashes) and artifex/core modules.
// Node runs the pieces from the same module table and sources the page gets.
function loadExternal(input, cwd = callerDirectory(), { confine } = {}) {
  const list = Array.isArray(input);
  if (list && !input.length) throw new Error('piece: loadExternal needs at least one piece');
  const ids = new Map(), modules = [], requires = new Map(), libraries = new Map(), library = new Set(), table = new Map();
  // Both sides are real paths (on-disk case, links followed), so a miscased or linked spelling of a listed file is that file.
  const root = confine && fs.realpathSync.native(path.resolve(cwd, confine.root));
  // The list takes the same form: a file spelled in another case is listed in its on-disk case. A listed link stays
  // as spelled (it lists itself, not its target), so a link to an unlisted file never matches the target's real path.
  const files = confine && new Set(confine.files.map((name) => {
    const given = path.resolve(root, name), real = realPath(given);
    return fold(real) === fold(given) ? slash(path.relative(root, real)) : name;
  }));
  const listed = (file) => files.has(slash(path.relative(root, realPath(file))));
  const outside = (file, spec) => new Error('piece: ' + file + ' requires ' + spec + ', which is not a listed file of ' + root + ' or artifex/core/<file>.js');
  function visit(file) {
    // The file's on-disk spelling, so a miscased path to core still names the library module,
    // and one module reached under two spellings (another case, a link) gets one id.
    const real = realPath(file);
    const within = inLibrary(real) ?? inLibrary(file);
    const relative = within === null ? '' : slash(within);
    if (/^(core|examples)\/[^/]+\.js$/.test(relative)) { library.add(relative); return relative; }
    if (ids.has(real)) return ids.get(real);
    const extension = path.extname(file).toLowerCase();
    if (!['.js', '.cjs', '.json'].includes(extension)) throw new Error('piece: browser bundles support CommonJS .js/.cjs and .json, not ' + file);
    const id = 'external/' + ids.size + '.js';
    ids.set(real, id);
    let source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/^#![^\n]*/, '');
    requires.set(id, []);
    libraries.set(id, []);
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
        const style = !confine && /^artifex\/styles\/([^/\\]+)$/.exec(dependency.spec);
        let resolved;
        if (core) {
          if (!CORE.includes(core[1])) throw new Error('piece: cannot resolve ' + dependency.spec + ' from ' + file + ': core/ has no module ' + core[1]);
          resolved = path.join(ROOT, 'core', core[1]);
        }
        else if (style) {
          resolved = path.join(ROOT, 'skills', 'artifex', 'styles', style[1]);
          if (!style[1].endsWith('.js') || !fs.existsSync(resolved)) throw new Error('piece: cannot resolve ' + dependency.spec + ' from ' + file + ': skills/artifex/styles/ has no module ' + style[1]);
        }
        else {
          if (confine && dependency.spec[0] !== '.') throw outside(file, dependency.spec);
          try { resolved = localRequire.resolve(dependency.spec); }
          catch (error) { throw new Error('piece: cannot resolve ' + dependency.spec + ' from ' + file + ': ' + error.message); }
          if (confine && !listed(resolved)) throw outside(file, dependency.spec + ' (' + resolved + ')');
        }
        dependency.id = visit(resolved);
        (dependency.id.startsWith('external/') ? requires.get(id) : libraries.get(id)).push(dependency.id);
      }
      for (const dependency of dependencies.reverse()) {
        source = source.slice(0, dependency.start) + 'require(' + json(dependency.id) + ')' + source.slice(dependency.end);
      }
    }
    // A string containing an HTML end tag is legitimate piece data. Escaping
    // its slash preserves the JS string value without ending the script tag.
    source = source.replace(/<\/script/gi, (marker) => '<\\/' + marker.slice(2));
    source = '__def(' + json(id) + ', function (module, exports, require) {\n' + source + '\n});';
    // `file` as first spelled, `real` its real path, so callers judge or key it by the file on disk.
    modules.push({ id, file, real, source });
    // The same text the page runs, compiled here so Node defines the module as the page does.
    vm.runInThisContext('(function (__def) {' + source + '\n})', { filename: file, lineOffset: -1 })((key, fn) => table.set(key, fn));
    return id;
  }
  // The page's require over the same table: library modules are the files the page bundles.
  // A require imports() did not read keeps its own id; it is refused by name rather than resolved
  // against the library root, which is not the piece's folder, where the page bundle lacks it and,
  // under confine, no listed-file check would see it.
  const cache = new Map();
  function run(id, from) {
    if (!table.has(id)) {
      if (!library.has(id)) throw new Error(from + ' requires ' + id + ' where no direct literal require was read, so ' + (confine ? 'it cannot be checked against the listed files of ' + root : 'the page cannot bundle it') + '; write it as its own require(\'<path>\') call');
      return require(path.join(ROOT, id));
    }
    if (!cache.has(id)) {
      const m = { exports: {} }, { file } = modules.find((one) => one.id === id);
      cache.set(id, m);
      table.get(id)(m, m.exports, (next) => run(next, file));
    }
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
    // Pieces compare by module id, so one file listed under two spellings is one piece.
    const named = byName.get(piece.name);
    if (named && named.id !== id) throw new Error('piece: ' + named.entry + ' and ' + entry + ' are both named ' + piece.name);
    byName.set(piece.name, { entry, id });
    const reached = [...reach(id)];
    pieces.push({ entry, id, piece, modules: reached, library: [...new Set(reached.flatMap((m) => libraries.get(m)))] });
  }
  const names = [...byName.keys()];
  const registry = "__def('examples/index.js', function (module, exports, require) {\n"
    + 'module.exports = Object.create(null);\n'
    + names.map((name) => 'module.exports[' + json(name) + '] = require(' + json(byName.get(name).id) + ');\n').join('')
    + '});';
  const source = modules.map((m) => m.source).concat(registry).join('\n');
  if (list) return { pieces, names, source, moduleCount: ids.size, modules, library: [...library], registry };
  const [{ entry, piece }] = pieces;
  // One piece reaches every module loaded, so `modules` is the piece's own set, library modules never among them;
  // not enumerable, so the result's listed fields stay as they were.
  return Object.defineProperty({ entry, piece, names, source, moduleCount: ids.size, stem: outputStem(entry), directory: path.dirname(entry) }, 'modules', { value: modules });
}

module.exports = { callerDirectory, isPiecePath, outputStem, imports, loadExternal, inLibrary, realPath, slash, quote, quoteWord, hint, shown, outRoot, outputDirectory, resolvePiece };
