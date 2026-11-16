'use strict';

// Where a JavaScript source's comments, strings, template text and regular
// expressions are, found in one left-to-right pass. The unread-name lint, test
// selection and the poster records all read comments through it, so they agree
// on what a comment is.

// Whether the `.` at `at` in `src` is not the last dot of a spread `...`: true
// for every other `.`, a number's decimal point (`1.`) included, since an
// operand has ended there either way. Only memberName() tells a member access
// from the `.` that ends a number.
const memberDot = (src, at) => src[at] === '.' && !src.startsWith('...', at - 2);

// Whether a name right after the code character at `at` (the last one before
// the name, past comments and whitespace) is a property or private name, not a
// variable or keyword: that character is a member access `.` or a `#`. The `.`
// at `numberDot`, where the scanner's last numeric literal ended (`1.`), is not one.
const memberName = (src, at, numberDot) => src[at] === '#' || (memberDot(src, at) && at !== numberDot);

// A numeric literal from its first character: hex, octal or binary, legacy
// octal (`01`, after which a `.` is a member access), or decimal with its
// fraction, exponent and BigInt suffix.
const NUMBER = /0[box][\da-f_]*n?|0[0-7]+(?!\d)|(?:\d[\d_]*\.?|\.)[\d_]*(?:e[+-]?\d[\d_]*)?n?/iy;

// The index past the numeric literal that starts at `at` in `src`, or `at`
// when none does: a literal starts at a digit that continues no name (`a1`,
// `\u{61}1`), or at a `.` before a digit that is not the last dot of a spread
// (`.5`). Both scanners step over literals with it, so a `.` it ends with ends a number.
function numberEnd(src, at) {
  const starts = /\d/.test(src[at])
    ? !/[\p{ID_Continue}$‌‍\\]$/u.test(src.slice(Math.max(0, at - 2), at)) && !(src[at - 1] === '}' && /\\u\{[\da-f]+\}$/i.test(src.slice(src.lastIndexOf('\\', at), at)))
    : /\d/.test(src[at + 1] || '') && memberDot(src, at);
  if (!starts) return at;
  NUMBER.lastIndex = at;
  return NUMBER.test(src) ? NUMBER.lastIndex : at;
}

// A word after which a slash may start a regular expression, not a division,
// unless it is a member name (regexAfter() checks that).
const BEFORE_REGEX = /(?<![\p{ID_Continue}$‌‍\\])(?:return|typeof|case|in|instanceof|of|void|delete|throw|else|yield|await|new|do)$/u;

// Whether `src` reads yield and await as keywords: each is one unless the
// source's code declares it as a name (`var yield`, `let await = …`, `, yield;`).
// The search runs over the source blanked once (comments, strings, template text
// and regular expressions removed), blanked as the raw source's own declarations
// say yield and await read. That mostly keeps a declaration in a comment, string
// or template from counting, but two shapes can still be misread: a declaration
// of yield or await inside a regular expression right after that same word
// (`await /let await = 1;/`) still counts, and a real declaration of one name can be hidden by a fake
// declaration of the other that sent the first blanking astray.
const declared = (src, name) => new RegExp(`(?:\\b(?:var|let|const)\\s+|,\\s*)${name}\\s*[=,;]`).test(src);
function keywordsIn(src) {
  const raw = { yield: !declared(src, 'yield'), await: !declared(src, 'await') };
  if (raw.yield && raw.await) return raw;
  const code = blank(src, raw);
  return { yield: !declared(code, 'yield'), await: !declared(code, 'await') };
}

/**
 * Whether a slash right after the word that ends at `end` in `src` starts a
 * regular expression: after a keyword such as return, typeof or in. `of` is a
 * keyword only where it ends a for-head binding (`for (const x of /re/…`), so
 * `inHead` says whether the innermost open parenthesis is a control head; yield
 * and await are keywords where `keywords` (keywordsIn(src) when left out) says
 * so. After any other name, or a member name (memberName() at `gap`, the last
 * code character before the word, the character right before it when left
 * out, and `numberDot` as memberName() takes it), the slash divides.
 */
function regexAfter(src, end, inHead, keywords, gap, numberDot) {
  const m = BEFORE_REGEX.exec(src.slice(Math.max(0, end - 11), end));
  if (!m || memberName(src, gap ?? end - m[0].length - 1, numberDot)) return false;
  if (m[0] === 'yield' || m[0] === 'await') return (keywords || keywordsIn(src))[m[0]];
  if (m[0] !== 'of') return true;
  let k = end - 3;
  while (k >= 0 && /\s/.test(src[k])) k--;
  return inHead && (src[k] === ']' || src[k] === '}' || (/[\p{ID_Continue}$‌‍]/u.test(src[k] || '') && !regexAfter(src, k + 1, false, keywords, undefined, numberDot)));
}

const LINE_END = /\r(?!\n)|[\n\u{2028}\u{2029}]/gu;

// The index of the first line terminator in `src` at or after `at`, as
// JavaScript reads one, or `src.length`. A CR ends a line alone; in a CRLF pair
// the LF does, so the CR stays on the line.
function lineEnd(src, at) {
  LINE_END.lastIndex = at;
  return LINE_END.test(src) ? LINE_END.lastIndex - 1 : src.length;
}

// Whether `c` ends a regular expression left open: a CR (alone or in a CRLF
// pair), an LF, U+2028 or U+2029.
const endsRegex = (c) => c === '\n' || c === '\r' || c === '\u{2028}' || c === '\u{2029}';

// The index of the quote that closes the string opened by the ' or " at `at`,
// or where one left open stops: at its first CR or LF (U+2028 and U+2029 are
// text), or `src.length`. An escaped line terminator, a CRLF pair included,
// continues the string onto the next line. A template goes to templateEnd().
function quotedEnd(src, at) {
  const q = src[at];
  let j = at + 1;
  while (j < src.length && src[j] !== q && src[j] !== '\r' && src[j] !== '\n') {
    j += src[j] !== '\\' ? 1 : src[j + 1] === '\r' && src[j + 2] === '\n' ? 3 : 2;
  }
  return Math.min(j, src.length);
}

// The index of the slash that closes the regular expression opened at `at`,
// outside a character class, or where one left open stops: at its line
// terminator (the CR of a CRLF pair), or `src.length`.
function regexEnd(src, at) {
  let j = at + 1, inClass = false;
  while (j < src.length && !endsRegex(src[j]) && (inClass || src[j] !== '/')) {
    if (src[j] === '\\') { if (!endsRegex(src[j + 1])) j++; }
    else if (src[j] === '[') inClass = true;
    else if (src[j] === ']') inClass = false;
    j++;
  }
  return Math.min(j, src.length);
}

/**
 * The ranges of `src` that are not code, in order, as [kind, start, end]. A
 * 'comment' range is the whole comment; a line comment stops before its line
 * terminator (a newline, a lone carriage return, U+2028 or U+2029).
 * A 'string', 'template' or 'regex' range is the literal's text inside its
 * delimiters, and a regular expression's flags are one more 'regex' range. The
 * code in a template's `${…}` is code. A regular expression left open stops at
 * its line terminator, at the CR of a CRLF pair; a string at a CR or LF.
 *
 * A slash starts a regular expression where an expression may begin: at the
 * start, after an operator, a spread `...`, an opening bracket, `,`, `;`, `{` or `}`, after the
 * `)` that closes an if, while, for or with head, or after a keyword as
 * regexAfter() reads one. After any other `)`, after `]`, a name, a literal or a
 * postfix `++` or `--`, it divides.
 *
 * `keywords` is `{ yield, await }`, each true where the word is read as a
 * keyword; keywordsIn(src) when left out.
 */
const scan = (src, keywords = keywordsIn(src)) => walk(src, 0, false, keywords).ranges;

/**
 * The index of the backtick that closes the template opened at `at`, or
 * `src.length` when it is left open. The code in each `${…}` is read as scan()
 * reads it, strings, comments, regular expressions and nested templates
 * included, so a backtick or brace inside one does not end the template.
 * `keywords` is keywordsIn(src), computed when left out.
 */
const templateEnd = (src, at, keywords = keywordsIn(src)) => walk(src, at, true, keywords).end;

// scan() from `from`; with `once`, it stops where the template opened at
// `from` closes and returns that index as `end`, and builds no ranges.
function walk(src, from, once, keywords) {
  const ranges = [];
  const add = (kind, a, b) => { if (!once && b > a) ranges.push([kind, a, Math.min(b, src.length)]); };
  const holes = []; // the brace depth at each open `${`
  const parens = []; // whether each open `(` follows if, while, for, with or for await
  // The control keyword that ends at `at`, or '' (also for a member name; `gap` is as regexAfter() takes it).
  const control = (at, gap) => {
    const m = /(?<![\w$])(?:if|while|for|with|await)$/.exec(src.slice(Math.max(0, at - 5), at + 1));
    return m && !memberName(src, gap ?? at - m[0].length, numberDot) ? m[0] : '';
  };
  let numberTo = 0, numberDot = -1; // where the last numeric literal ends, and the `.` that ended one last
  let depth = 0, prev = '', prevAt = -1; // the last code character and its index
  let prev2 = '', prev2At = -1, postfix = false; // the code character before prev, and whether a ++ or -- ending at prev is postfix
  // Whether a slash after the code character `p` at `pAt` starts a regular expression, going by that character alone.
  const exprStart = (p, pAt) => !p || /[(,=:[!&|?{};*%<>~^\/]/.test(p) || (p === '.' && !memberDot(src, pAt)) || regexAfter(src, pAt + 1, parens[parens.length - 1], keywords, wordGap, numberDot);
  let wordGap = -1; // the last code character before the current word, past comments
  // Template text from `from` to its closing backtick or next `${`.
  const template = (from) => {
    let j = from;
    while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
    add('template', from, j);
    if (src[j] === '$') { holes.push(depth); prev = '{'; prevAt = j + 1; return j + 1; }
    prev = 'a'; prevAt = j;
    return j;
  };
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const end = lineEnd(src, i);
      add('comment', i, end);
      i = end - 1;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      add('comment', i, end < 0 ? src.length : end + 2);
      i = end < 0 ? src.length : end + 1;
    } else if (c === '"' || c === "'") {
      const j = quotedEnd(src, i);
      add('string', i + 1, j);
      i = j;
      prev = 'a'; prevAt = j;
    } else if (c === '`' || (c === '}' && holes.length && holes[holes.length - 1] === depth)) {
      if (c === '}') holes.pop();
      i = template(i + 1);
      if (once && !holes.length) return { ranges, end: Math.min(i, src.length) };
    } else if (c === '/' && (exprStart(prev, prevAt) || (/[+-]/.test(prev) && !postfix))) {
      const j = regexEnd(src, i);
      add('regex', i + 1, j);
      i = j;
      if (src[j] === '/') { // its flags
        while (/[a-z]/.test(src[i + 1] || '')) i++;
        add('regex', j + 1, i + 1);
      }
      prev = 'a'; prevAt = i;
    } else {
      if (i >= numberTo && (c === '.' || (c >= '0' && c <= '9'))) { numberTo = numberEnd(src, i); if (numberTo > i && src[numberTo - 1] === '.') numberDot = numberTo - 1; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '(') { const word = control(prevAt, wordGap); parens.push(word === 'await' ? control(wordGap) === 'for' : word !== ''); }
      if (!/\s/.test(c)) {
        if (/[\w$]/.test(c) && !/[\w$]/.test(src[i - 1] || '')) wordGap = prevAt;
        // A ++ or -- is postfix only right after an operand on the same line.
        postfix = (c === '+' || c === '-') && prev === c && prevAt === i - 1 && !exprStart(prev2, prev2At) && !/[+-]/.test(prev2) && !/[\n\r\u{2028}\u{2029}]/u.test(src.slice(prev2At + 1, prevAt));
        prev2 = prev; prev2At = prevAt;
        prev = c === ')' && parens.pop() ? ';' : c; prevAt = i;
      }
    }
  }
  return { ranges, end: src.length };
}

// `src` with its comments removed and everything else as written. A block
// comment leaves one space, so the names on either side of it stay apart.
function uncomment(src) {
  let out = '', at = 0;
  for (const [kind, a, b] of scan(src)) if (kind === 'comment') { out += src.slice(at, a) + (src[a + 1] === '*' ? ' ' : ''); at = b; }
  return out + src.slice(at);
}

// `src` with its comments and the text of its strings, templates and regular
// expressions blanked to spaces, so a name in prose is not code. Line
// terminators (\n, \r, U+2028, U+2029), quotes and the code in `${…}` stay, so
// every index and line still points where it did. `keywords` is as scan() takes it.
function blank(src, keywords) {
  const out = src.split('');
  for (const [, a, b] of scan(src, keywords)) for (let k = a; k < b; k++) if (!endsRegex(out[k])) out[k] = ' ';
  return out.join('');
}

module.exports = { scan, uncomment, blank, lineEnd, quotedEnd, templateEnd, regexEnd, regexAfter, keywordsIn, memberDot, memberName, numberEnd };
