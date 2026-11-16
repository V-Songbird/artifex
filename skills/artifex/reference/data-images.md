---
type: knowledge
summary: "Rules for an Artifex piece that must be read for its data, such as a chart, map, timeline or diagram, each with a check to run on the piece's own state or frames: data fixed against seed, params and box, honest scales and gaps, a frame that reads alone and its fresh-reader test, the form that fits the data, colour steps and how many categories; read before drawing data that a viewer must read."
related_files: ["skills/artifex/SKILL.md", "examples/readout.js", "core/colour.js", "core/stroke-font.js", "core/piece.js"]
---

# Data images

## Contents

- [The data decides what it says](#the-data-decides-what-it-says)
- [It reads alone](#it-reads-alone)
- [The form fits the data](#the-form-fits-the-data)
- [Colour and categories](#colour-and-categories)

Read this with [the core skill](../SKILL.md) when a piece must be read for its
data: a chart, a map, a timeline or a diagram. A data piece made as art
follows only the first section, on what the data says, and lists the rest in
its [looks to leave out](making.md#ask-which-looks-to-leave-out).
`examples/readout.js`, which sets no type, is a data piece made as art. A
film that explains its data also takes its acts, shot order, unit marks and
counters from [a film that explains](films.md#a-film-that-explains).

## The data decides what it says

- **A dataset fixed against seed and params shows every render the same
  facts.** They change how the data looks, not its values, order or
  selection. Check: solve at two seeds and at each param's minimum and
  maximum, and compare the data in the state; it is identical. The two-seed
  half is the check `examples/readout.js` names at its top.
- **Keep the plot's proportions fixed at every box.** In a piece that declares
  [`boxes`](contract.md), a plot that stretches to the box
  flattens every rise in a wide box and steepens it in a tall one, so fix the
  plot's width-to-height ratio and give the rest of the box to margin and
  text. Check: solve with `atBox` at the four corners of the declared ranges,
  at three seeds, and compare the length ratio of two fixed marks and the
  slope between two fixed points; both stay equal. Bars that start at zero
  keep their length ratio even in a stretched plot, so the slope is the
  half of the check that catches it.
- **Choose neither the value range nor the plot's proportions to make a
  difference look larger or smaller.** A bar's length starts at zero, and time
  is spaced in proportion to time. Check: every bar's base lies on the zero
  line, and along the time axis the distance between two marks divided by the
  time between them is the same everywhere.
- **Show every gap in the data as a gap.** A missing period keeps its empty
  place on the axis, labelled as missing, so the reader sees the break; a
  closed, guessed or trimmed gap tells another story, and so does leaving out
  values that would change it. Check: the number
  of periods in the data equals the number of places on the axis, and each
  missing one is empty and labelled.

## It reads alone

- **Say in the frame what is measured, in what units, what the whole is and
  where the data came from.** Give it a title of about six words or fewer, and
  keep every line of text 10% inside every edge, as
  [text in the frame](making.md#text-in-the-frame) asks. Check: the four
  facts are each written in the frame, and every string's box lies inside the
  inset.
- **Write a unit in words where the stroke font has no mark.** It draws no
  `%`, `+`, `°` or `=`, and leaves a gap for each. Check: `font.missing(str)`
  returns `[]` for every label; otherwise write the unit in words, such as
  "percent", or draw the mark yourself.
- **Label values on or beside their marks, and order a legend as the marks
  stand.** Label each bar, slice and timeline item directly; give a line its
  end value and its highest and lowest values rather than one per point. A
  swatch list beside a stacked bar runs top to bottom in the order of the
  bar's parts. Check: each bar, slice and timeline item carries its value,
  each line carries its end and extreme values, and the legend's first swatch
  names the topmost part.
- **Test the reading on a fresh reader.** As in a film's
  [fresh-eyes review](films.md#fresh-eyes-review), give a subagent started
  without this work's context only the PNG or MP4, and ask what is largest,
  what rises or falls, what the image claims, and its measure, units, whole
  and source. Check: its answers match the data; a misreading is a fault of
  the image, so change the image.
- **In a film, hold every value and label fully drawn long enough to read it
  aloud slowly.** Count the hold from the frame its last stroke arrives.
  Check: with `--at`, take that frame and the last frame the text stays; the
  time between them is at least the time it takes to read the text aloud
  slowly, and no cut or beat falls inside it.

## The form fits the data

- **Choose the form by what the data is.** Dates go on a timeline, places on a
  map, parts of a whole in a pie, a comparison in bars and change over time in
  a line. Check: name the data's kind and the form the piece draws; they
  match this list, or the comment at the top of the source says why not.
- **Give a pie five slices or fewer, flat, with its whole named.** Check: count
  the slices, the shares sum to 100 percent, and nothing is extruded or tilted;
  with more slices, draw bars.
- **Give a timeline about 10 to 20 items, placed to scale.** When the gaps
  between items dominate, use a list. Check: count the items, and the spacing
  follows the dates.
- **A diagram's layout is geometry; its look is the piece's.** `radar`,
  `timeline`, `layered` (a flow chart or a state diagram) and `sankey` from
  `core/diagram.js` lay the data out and return points, boxes and paths, with
  text measured by the lettering the piece will draw
  ([diagrams](../../../docs/apis/diagrams.md)). The piece draws them with the
  marks of its style, so the same flow reads as a pencil sketch or a print,
  and in a film each part can arrive in its turn. Check: change one value in
  the data and draw again; the layout follows it, and no coordinate of the
  diagram is written by hand.
- **Run time from left to right.** Bars stand upright for time and lie flat
  for categories. Check: time increases to the right.
- **Keep on a map only what its question needs, plus a scale, a north mark and
  a reference point.** Check: every element answers the question, and the
  three are present.
- **Keep ornament and grid quieter than the data.** Check: in the `--grey`
  view, the grid's lightness step from the ground is smaller than every data
  mark's, and no decoration sits on a data mark.

## Colour and categories

- **Use one hue unless the data must separate groups, then one hue per
  group.** The viewer joins what shares a colour, as
  [same colour, same group](stills.md#art-direction-preset-focal-composition)
  says. Check: the number of hues equals the number of groups.
- **Step adjacent fills at least 0.2 apart in OKLCh lightness, or give them
  distinct patterns.** Steps of 0.1 or less blur together on a contact sheet,
  in grey and in the colour-vision views. Check: `oklch(c)[0]` from
  `core/colour.js` differs by 0.2 or more for each adjacent pair, and the
  steps stay apart under `--grey` and `--colour-vision`
  ([value, greyscale and colour-vision views](../../../docs/knowledge/command-line-tools.md#value-greyscale-and-colour-vision-views)).
- **Keep the categories a viewer must hold to about seven.** Above that, group
  them or split the chart. Check: count the legend entries or the distinct
  categories in the frame.
