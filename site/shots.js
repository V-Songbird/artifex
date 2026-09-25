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
// The intro, the bloom seam, the ink shot, the crack seam, the mirror shot,
// the bend seam and the portal seam are the site's art. The three shots after them (rows, grid, cells) are placeholders that
// keep the stage's worker tier and recipe checks exercised until the real
// shots replace them.
'use strict';

module.exports = {
  hz: 30,
  seed: 1,
  shots: [
    { name: 'intro', piece: './pieces/intro.cjs', text: 'A plotter pen writes the name, one line at a time. Scroll back and it lifts every line again: each frame is a function of a seed and a playhead.' },
    { name: 'bloom', piece: './pieces/bloom.cjs', seam: true, text: 'A wide brush of clean water crosses the last line while its ink is still wet, and the ink blooms out into the water along its current.' },
    { name: 'ink', piece: './pieces/ink.cjs', poster: './posters/ink.webp', title: 'Solved, not traced', text: "The brush takes up the ink blooming in the water and lays that one ink along the water's current: wide pale washes first, dark strokes last. Every stroke is walked through the same field; nothing is traced." },
    { name: 'crack', piece: './pieces/crack.cjs', seam: true, text: "The ink dries and the film cracks: each crack runs between the cracks before it and meets them square, finer near the painting's focus, until the sheet is a partition." },
    { name: 'mirror', piece: './pieces/mirror.cjs', poster: './posters/mirror.webp', title: 'Structure is the subject', text: 'The torn pieces lift off the table. Three mirrors stand on the sheet, and the triangle between them repeats by reflection, ring by ring, into the wallpaper group their angles make.' },
    { name: 'bend', piece: './pieces/bend.cjs', seam: true, text: 'The three mirrors, pinned at their corners, bow inwards. The wallpaper turns hyperbolic, its reflections crowding without end towards one circle, and the mirrors turn together, as a kaleidoscope is turned.' },
    { name: 'portal', piece: './pieces/portal.cjs', seam: true, text: 'A page torn from a notebook, a bird doodled on it in ballpoint, is slid in under a mirror, and the kaleidoscope carries it into every reflection. The camera goes into one mirror, to its reflection of the page.' },
    { name: 'rows', piece: './pieces/rows.cjs', title: 'A placeholder shot', text: 'Scroll, and a pen rules rows across the page. Scroll back and it lifts them again: every frame is a function of the seed and the playhead.' },
    { name: 'grid', piece: './pieces/grid.cjs', seam: true, text: 'Columns cross the rows, and the cells they make fill.' },
    { name: 'cells', piece: './pieces/cells.cjs', seconds: 2, tier: 'worker', title: 'A placeholder still', text: 'The finished grid holds while you read, drawn off the main thread where the browser allows it.' },
  ],
};
