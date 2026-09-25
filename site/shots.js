// The site's shot list, in scroll order. Each shot is an ordinary Artifex
// piece; `npm run site` resolves the list on whole frames of `hz`, so the
// scroll position is one playhead for the whole site.
//
// Per shot: `name` (kebab-case, unique, used in recipe URLs), `piece` (path
// from this file), and optionally `seam` (a transformation between two shots:
// no still under reduced motion, hidden from assistive technology), `seconds`
// (required for a still, refused for a timed piece, which lasts its own
// duration), `tier: 'worker'` (drawn off the main thread), `still` (the
// playhead shown under reduced motion, 1 by default), `poster` (an image drawn
// from the same recipe), `title` and `text`.
//
// These three shots are placeholders that prove the stage, not the site's art.
'use strict';

module.exports = {
  hz: 30,
  seed: 1,
  shots: [
    { name: 'rows', piece: './pieces/rows.cjs', title: 'A placeholder shot', text: 'Scroll, and a pen rules rows across the page. Scroll back and it lifts them again: every frame is a function of the seed and the playhead.' },
    { name: 'grid', piece: './pieces/grid.cjs', seam: true, text: 'Columns cross the rows, and the cells they make fill.' },
    { name: 'cells', piece: './pieces/cells.cjs', seconds: 2, tier: 'worker', title: 'A placeholder still', text: 'The finished grid holds while you read, drawn off the main thread where the browser allows it.' },
  ],
};
