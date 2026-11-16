'use strict';

// The built page's accessible names, roles and live regions, and the plain
// words its notes use. The markup is read from the page as built; the names the
// script sets are read from a stand-in page. A screen reader is not run here.

const test = require('node:test');
const assert = require('node:assert/strict');
const { html, bundle } = require('../tools/build-page.js');
const { fakePage } = require('./fake-media.js');

const page = html(bundle());
const tag = (id) => page.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`))[0];

test('the page markup names its controls, links each export to its note and announces errors', () => {
  // Each label and the heading look capitalized and are named in their own case:
  // the capitals are drawn on a copy hidden from assistive technology.
  const caps = (text) => `<span aria-hidden="true">${text}</span><span class="sr">${text}</span>`;
  assert.ok(page.includes(`<label class="label" for="seed">${caps('Seed')}</label>`));
  assert.ok(page.includes(`<label class="label" for="t" style="margin-top:12px">${caps('Playhead')}</label>`));
  assert.ok(page.includes(`<label class="label" for="previewMode">${caps('Preview renderer')}</label>`));
  for (const text of ['Declared parameters', 'Box', 'Outputs', 'Measured']) assert.ok(page.includes(`<div class="label">${caps(text)}</div>`), text);
  assert.ok(page.includes(`<h1>${caps('Artifex')}</h1>`));
  assert.doesNotMatch(page, /class="label"[^>]*>(?!<span aria-hidden="true">)/, 'no label is left without its named copy');
  assert.match(page, /\.sr \{[^}]*text-transform: none;/);
  assert.match(page, /<button id="film1"[^>]*aria-describedby="filmnote"[^>]*>MP4 1920 px<\/button>/);
  assert.match(page, /<button id="film2"[^>]*aria-describedby="filmnote"[^>]*>MP4 1x draft<\/button>/);
  assert.match(page, /<button id="video" aria-describedby="videonote">WebM film<\/button>/);
  assert.match(page, /<button id="svg" aria-describedby="svgnote">SVG<\/button>/);
  assert.doesNotMatch(page, /WebM video/);
  for (const id of ['svgnote', 'filmnote', 'videonote']) assert.match(tag(id), /aria-live="polite"/, id);
  // The WebM recording's timings are shown beside its note, never announced.
  assert.match(page, /<div class="note" id="videonote" aria-live="polite"><\/div>\s*<div class="note" id="videofigures"><\/div>/);
  // So are the MP4 film's colour route and timings.
  assert.match(page, /<div class="note" id="filmnote" aria-live="polite"><\/div>\s*<div class="note" id="filmfigures"><\/div>/);
  assert.match(tag('c'), /role="img"/);
  // The error sits in an alert region at the end of Outputs, before Measured.
  const alert = page.match(/<div role="alert"[^>]*>\s*<div class="err" id="err"><\/div>\s*<div class="err" id="errnext"><\/div>\s*<\/div>/);
  assert.ok(alert, 'err and its next step share one alert region');
  const at = alert.index;
  assert.ok(page.indexOf('>Outputs<') < at && at < page.indexOf('>Measured<'), 'the alert follows the export buttons');
});

function registry(module) {
  module.exports = {
    tuned: {
      name: 'tuned', size: { w: 40, h: 30 }, seed: 7, time: { duration: 1, hz: 4 }, outputs: ['raster'],
      params: { reach: { value: 0.5, min: 0, max: 1, meaning: 'how far each stroke travels' } },
      build: [['check', (state) => { if (state.seed === 13) throw new Error('fixture build failed'); }]],
      draw(surface) { surface.fillRect(0, 0, 20, 20); },
    },
    still: { name: 'still', size: { w: 40, h: 30 }, outputs: ['raster', 'vector'], draw(surface) { surface.fillRect(0, 0, 20, 20); } },
    flat: { name: 'flat', size: { w: 40, h: 30 }, draw(surface) { surface.fillRect(0, 0, 20, 20); } },
  };
}

test('sliders, the canvas and the build failure carry accessible names and a next step', () => {
  const { api, elements } = fakePage({ modules: { 'examples/index.js': registry }, fields: () => ({ disabled: false }) });
  const [, meaning, slider] = elements.get('params').children;
  assert.equal(slider.attributes['aria-label'], 'reach');
  assert.equal(slider.attributes['aria-describedby'], 'meaning-0');
  assert.equal(meaning.id, 'meaning-0');
  assert.equal(meaning.textContent, 'how far each stroke travels');
  assert.equal(elements.get('c').attributes['aria-label'], 'tuned, seed 7, frame 1 of 4');
  assert.equal(elements.get('t').attributes['aria-valuetext'], 'frame 1 of 4', 'the playhead speaks its frame, not its 0-1000 value');
  api.setT(1);
  assert.equal(elements.get('c').attributes['aria-label'], 'tuned, seed 7, frame 4 of 4');
  assert.equal(elements.get('t').attributes['aria-valuetext'], 'frame 4 of 4');
  assert.equal(elements.get('svgnote').textContent, 'SVG is off: this piece draws pixels, not vector paths. Export PNG instead.');

  api.setSeed(13);
  assert.equal(api.read().error, 'build stage "check" (1 of 1) threw: fixture build failed', 'the diagnostic itself is unchanged');
  assert.equal(elements.get('errnext').textContent, 'Playback and exports are off until the piece builds: try another seed or parameter value, or fix the stage the error names.');
  assert.equal(elements.get('c').attributes['aria-label'], 'tuned: no picture, the build failed');
  assert.equal(elements.get('t').attributes['aria-valuetext'], 'no picture');
  api.setSeed(7);
  assert.equal(elements.get('errnext').textContent, '');

  api.select('still');
  assert.equal(elements.get('c').attributes['aria-label'], 'still, seed 1, a still');
  assert.equal(elements.get('t').attributes['aria-valuetext'], 'a still');
  assert.equal(elements.get('filmnote').textContent, 'This piece is a still: it declares no timeline, so it has no film. Export PNG or SVG, or give the piece a time field to make it a film.');
  api.select('flat');
  assert.equal(elements.get('filmnote').textContent, 'This piece is a still: it declares no timeline, so it has no film. Export PNG, or give the piece a time field to make it a film.');
});
