'use strict';

// Shared by the tests that rewrite a saved SVG's replay manifest.

/** An SVG with its manifest replaced, escaped as the vector surface writes it. */
const withManifest = (svg, m) => svg.replace(/(<metadata id="artifex-manifest">)[^<]*(<\/metadata>)/,
  (_, open, close) => open + JSON.stringify(m).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) + close);

module.exports = { withManifest };
