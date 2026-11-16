'use strict';

/**
 * The js code blocks of one Markdown text: { line, heading, source }. The one rule for
 * which fences are js samples, shared by test selection (tools/run-tests.js) and
 * tests/skill-samples.test.js: a fence may be indented, a space may precede the language,
 * `js` and `javascript` count, and the block ends at the next line holding only a fence.
 * Prose names no dependency.
 */
function jsSamples(markdown) {
  const samples = [];
  let heading = '', open = null;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const fence = /^(\s*)```\s*([\w-]*)[^`]*$/.exec(text);
    if (!open) {
      if (fence) open = { indent: fence[1].length, lang: fence[2], line: index + 1, heading, body: [] };
      else { const title = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text); if (title) heading = title[1]; }
    }
    else if (/^\s*```\s*$/.test(text)) {
      if (open.lang === 'js' || open.lang === 'javascript') {
        samples.push({ line: open.line, heading: open.heading, source: open.body.join('\n') });
      }
      open = null;
    }
    else open.body.push(text.slice(Math.min(open.indent, text.length - text.trimStart().length)));
  });
  return samples;
}

module.exports = { jsSamples };
