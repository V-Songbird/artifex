'use strict';

// The product page's two themes: every pair of colours that carries text,
// read from home.css, meets WCAG 2.2's contrast in both, and the dark tokens
// the system setting picks are the ones the toggle picks.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'home.css'), 'utf8');

/** The custom properties declared in the first rule whose selector is `selector`. */
function tokens(selector) {
  const at = css.indexOf(selector + ' {');
  assert.ok(at >= 0, 'home.css has no rule ' + selector);
  const body = css.slice(at + selector.length + 2, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [text, ground, least ratio]: body text 4.5:1; the eyebrow, links and outputs are small text too.
const PAIRS = [
  ['ink', 'ground', 4.5], ['quiet', 'ground', 4.5], ['ink', 'raised', 4.5], ['quiet', 'raised', 4.5],
  ['accent', 'ground', 4.5], ['second', 'ground', 4.5], ['third', 'ground', 4.5], ['accent', 'raised', 4.5],
  ['accent-ink', 'accent', 4.5], ['ground', 'second', 4.5], ['ground', 'ink', 4.5],
  ['code-ink', 'code', 4.5], ['focus', 'ground', 3],
];

test('site: every text colour of the product page meets its contrast in both themes', () => {
  const themes = { light: tokens(':root'), dark: tokens(':root[data-theme="dark"]') };
  const report = [];
  for (const [name, t] of Object.entries(themes)) {
    for (const [fg, bg, least] of PAIRS) {
      assert.ok(t[fg] && t[bg], name + ' theme declares --' + fg + ' and --' + bg);
      const ratio = contrast(t[fg], t[bg]);
      report.push(name + ' ' + fg + '/' + bg + ' ' + ratio.toFixed(2));
      assert.ok(ratio >= least, name + ': --' + fg + ' on --' + bg + ' is ' + ratio.toFixed(2) + ':1, under ' + least + ':1');
    }
  }
  console.log(report.join('\n'));
});

test('site: the system dark setting and the dark toggle use the same tokens', () => {
  const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  const system = Object.fromEntries([...media.slice(0, media.indexOf('}')).matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  assert.deepEqual(system, tokens(':root[data-theme="dark"]'));
});
