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
// the bend and portal seams, the trace and print seams, the CAD shot, the fold
// and paint seams, the Kandinsky shot and the wall of every style are the
// site's art. The three shots after them (rows, grid,
// cells) are placeholders that keep the stage's worker tier and recipe checks
// exercised until the real shots replace them.
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
    { name: 'trace', piece: './pieces/trace.cjs', seam: true, text: 'The mirror lets go and the page lies flat. Drafting film goes down over the doodle and every line is inked square: the branch along a T-square, the legs and the beak against a set square, the eye round a template.' },
    { name: 'print', piece: './pieces/print.cjs', seam: true, text: 'The page is pulled from under the film. A lamp exposes the cyanotype beneath, the film is lifted away, and water washes the print blue: the doodle is a blueprint.' },
    { name: 'cad', piece: './pieces/cad.cjs', poster: './posters/cad.webp', title: 'One subject, ten media', text: 'The same bird crosses every medium. On the blueprint, the plotter from the first shot lays the CAD drawing a layer at a time: views, section, dimensions and fold lines, each in its own colour.' },
    { name: 'fold', piece: './pieces/fold.cjs', seam: true, text: 'A knife cuts the plot out part by part. The parts rise onto their own layers, the wing folds on its phantom line, and the sheet tears into strips: papercraft.' },
    { name: 'paint', piece: './pieces/paint.cjs', seam: true, text: 'A wide knife spreads a thick ground over the papercraft, and the paper soaks up its oil. A brush lays the paint on in short, thick strokes, each dragging a little of the last: the swirling background first, the bird last.' },
    { name: 'kandinsky', piece: './pieces/kandinsky.cjs', poster: './posters/kandinsky.webp', title: 'Thick paint, scraped thin', text: "A palette knife drags the strokes off in long passes, smearing their colour across the ground, and spreads the bird's own paint into circles, arcs, bars and lines: the same bird, as a Kandinsky." },
    { name: 'wall', piece: './pieces/wall.cjs', poster: './posters/wall.webp', still: 0.6, title: 'Ask for any style', text: 'A frame is lowered over the painting, and it lies among one framed work of every style in the library, the same bird drawn by each: papercraft, a 3D render, CAD, pixel art, embroidery, a sticker, voxels, a doodle, Kandinsky, impasto, a circuit board, watercolour, sumi-e, a star atlas and light painting. The camera chooses one.' },
    { name: 'rows', piece: './pieces/rows.cjs', title: 'A placeholder shot', text: 'Scroll, and a pen rules rows across the page. Scroll back and it lifts them again: every frame is a function of the seed and the playhead.' },
    { name: 'grid', piece: './pieces/grid.cjs', seam: true, text: 'Columns cross the rows, and the cells they make fill.' },
    { name: 'cells', piece: './pieces/cells.cjs', seconds: 2, tier: 'worker', title: 'A placeholder still', text: 'The finished grid holds while you read, drawn off the main thread where the browser allows it.' },
  ],
};
