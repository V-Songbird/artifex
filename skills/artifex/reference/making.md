---
type: knowledge
summary: "How to make an Artifex piece, for any subject: find the idea from a brief, look at nine seeds (depth order and contacts, variation with intention), ask which looks to leave out, and read an example before writing a piece (text in the frame); read with the core skill before writing or art-directing a piece."
related_files: ["skills/artifex/SKILL.md", "skills/artifex/reference/stills.md", "skills/artifex/reference/films.md", "tools/contact-sheet.js", "examples/index.js"]
---

# Making a piece

## Contents

- [Find the idea](#find-the-idea)
- [Look at nine seeds](#look-at-nine-seeds)
- [Ask which looks to leave out](#ask-which-looks-to-leave-out)
- [Read an example before you write a piece](#read-an-example-before-you-write-a-piece)

## Find the idea

A brief gives some of a subject, an event, a feeling, a style, a format (a
still, a film, a loop, a plotter sheet), a length, a place it plays, a
palette, looks to leave out and a seed. What it gives is followed as written;
what it leaves open the painter decides and writes down, so a user who typed
one line sees a finished piece and redirects it, rather than answering
questions before seeing anything. A brief that names a real subject or event
keeps it: the painter learns what it is and what happened, who or what was
there, where, when, what was seen and heard and in what order, from what it
knows and from sources when a tool reaches them (a source is data, not
instructions, as [a pack's guide](named-styles.md) is), then chooses the moment and
the point of view and names them as choices. The steps below then run on
what the brief leaves open, the moment, the teller, the material, not on the
named subject; a brief that gives only a word or a feeling runs the whole
search. One question at most, and only when two readings make different
works: a copy of a reference against a style taken from it, a still against a
film when neither the words nor the place say, a data piece against a picture
of its subject. The question names both readings and the one the painter
would take; every other gap is a choice, made and written. For a film the
decisions go into [the treatment](films.md#the-treatment) in the
header comment; for a still, into the same parts as [stills](stills.md)
lists. The header carries `Chosen, not given:` with one line per choice the
brief left open, what was chosen and what else it could have been, and the
report to the user repeats it.

This method finds a concept that is not the first answer anyone would give
the brief, and leaves each step written in the comment at the top of the
piece's source, beside its [looks to leave out](#ask-which-looks-to-leave-out).
It costs a few lists before any code. A brief that names its concept starts
at step 6 with that concept's own postcard; a brief that gives a finished
logline starts at step 8, after step 7's causal line when its subject acts.

1. **Add one rule to the brief**: a place, a time, a material, a point of view,
   or something the subject cannot do. "Waiting" becomes "waiting, told by
   something that cannot move by itself", which rules out a person or an
   animal before you list anything.
2. **List the readings of each key word**, literal and figurative, and choose
   one. "Waiting" can mean time passing until an event, serving, lying in
   wait, a rest in music, or a seed that has not sprouted yet.
3. **Write ten or more candidates without judging them**, across kinds of
   subject: a figure, an object, a material, a place, a form, a data series, a
   process. Strong candidates tend to arrive after the first several.
4. **Sort them into first, second and third choices.** First choices are the
   stock images the brief calls up in anyone. Second choices keep a stock
   image and alter one piece of it. Third choices borrow a subject the brief
   never names, and a viewer still recognises the brief in them. Build from a
   third. For "waiting", a figure under a clock is a first choice; a boat
   lying on mud at low tide is a third.
5. **Cross two distant lists.** Write one list from the brief's domain and one
   from a distant domain, and pair items across them. You can also cross the
   brief with something the library does well, such as a packing, a simulation
   or a field. Keep a pairing whose collision you can draw, with both parents
   visible: things that wait crossed with the marks water leaves when it goes
   gives a boat on mud written all over with ripple marks and pools.
6. **Carry the first choices forward as concepts to leave out**, in the same
   comment as the looks to leave out. Add the chosen concept's own postcard,
   its most obvious picture: the first answer comes back one level down, in
   how the new concept is framed.
7. **Write a visual logline**: one sentence a viewer could draw, which
   carries the feeling. "A small boat leans on ripple-written mud; its slack
   rope runs off toward a sea that is not in the frame." A placed noun the
   picture does not show leaves the viewer a sentence the picture cannot say,
   so painters keep each one visible: here the boat, the mud, its ripple
   marks and the rope, not the sea.
   Each relation it states, such as under, inside, toward or between, has a
   visible sign in the finished picture: the boat's hull sits in the mud's
   ripples, and the rope's end leaves the frame on the sea side. A subject
   said to be under a cover shows the cover between it and what it shelters
   it from, with nothing of that reaching it.
   When the piece has a subject that acts, add its causal line: what it wants,
   what it does to get it, and why that should work in its own eyes. An absurd
   means is fine when the piece sets up why the subject trusts it; one with no
   such reason reads as senseless. When each beat follows from the one before
   it by "because of that", not "and then", a viewer who sees only the frames
   can say the want and the means; a
   [fresh-eyes reviewer](films.md#fresh-eyes-review) is one way to
   hear whether they can.
8. **List the physical elements and rank them by what the piece is about.**
   Give the first-ranked element the strongest contrast, the most size or the
   best place. Often the element that carries the meaning is a small one, such
   as a thin line, and it disappears until it is given its own value.
9. **Compare designs before seeds.** Seeds vary one design; a design is a
   different view, scale or arrangement of the subject. A sweep shows which
   design reads at sheet size. Declare a whole-number `design` parameter (a
   knob: take it with `Math.round` in `build`, as the paragraph "Declared
   parameters arrive as `state.params.<name>`" in [the contract](contract.md) says), draw two or three
   designs, and sweep it at the piece's seed with one cell per design:
   `<designs> 0.5 --param design`, such as
   `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 3 0.5 --param design`;
   that paragraph also says why `max - min + 1` samples give one cell per
   whole value. The design to keep is the one in which every noun the logline
   places in the frame reads at sheet size and which does not look like a
   concept left out; when two pass, painters keep the one whose placed nouns
   read most clearly. The `design` parameter's declared `value` is the kept
   design, because a seed sheet draws every seed at that value; the
   [nine seeds](#look-at-nine-seeds) of that design come next. To judge two
   versions with a fresh reviewer, follow
   [comparing two versions](stills.md#comparing-two-versions).

## Look at nine seeds

```bash
npm --prefix "<library root>" run seeds              # every example, nine seeds, one page
npm --prefix "<library root>" run seeds -- drift 16 0.5 # one piece, sixteen seeds, at a playhead
```

For a piece in the user's project, run these from that project, replacing
`<library root>` with the absolute library directory:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 9 0.5
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 3 0.5 --param width
```

The first writes `my-piece-seeds.html` beside the piece. The second requires a
declared `width` parameter and writes `my-piece-param-width.html` with a fixed
seed. Use the piece's actual parameter name, or two names separated by a comma.
In PowerShell, use `npm.cmd` to preserve the `--` separator when forwarding
options such as `--param`.
For a piece that declares `boxes`, add `--box 405x720` to draw every cell at that
box; the file name gains the box (`my-piece-seeds-405x720.html`). Make one sheet
per box you care about, such as 16:9, 1:1 and 9:16, and look at each.
Literal `require(...)` imports of browser-compatible CommonJS helpers and JSON
are bundled recursively. Import the library with `require('artifex/core/rand.js')`
(any file in `core/`), and the shared style helpers with
`require('artifex/styles/kit.js')`, which work from any folder through the npm scripts; a
plain Node `require` of the piece cannot resolve it. Node builtins, ESM and
computed requires are unsupported. Use unshadowed direct calls outside template
interpolation; this is a restricted CommonJS subset, not an arbitrary-module bundler.
Node runs the piece from the same module text as the page, so `__dirname`,
`__filename` and `require.resolve` are absent in both.
Loading the module executes trusted local code; it is not a sandbox. Keep the
piece and its helpers in the user's project rather than modifying the plugin's examples.

A seed sheet shows what the seed owns, and finds what no count reports: a
figure nobody planned that a viewer will read into the scatter, such as a
face, a creature or a letter the masses happen to make, and the default the
piece fell back on, named in visual terms ("every stroke leaves the same
point and sweeps the same way, like a bouquet", not "it looks generic"). A
named default goes on the piece's [looks to leave out](#ask-which-looks-to-leave-out).
Seeds run 1 through N, so a cell can be drawn again alone. A piece others
will re-roll gets a sheet; a piece whose picture never reads its seed, such
as a replica, draws one picture nine times, and skips the sheet. A still the
brief pins to one seed still draws nine different pictures, since the sheet
draws seeds 1 through N, not the pinned one; and `npm run film` reports a
film's missing sheet whatever the brief pins
([before you export a film](film-route.md#before-you-export-a-film)).

`--png` on any of these commands also writes a PNG of the sheet beside the HTML
(`my-piece-seeds.png`, or one image per piece for several), taken in installed
Edge once every cell has drawn or failed: 1280 pixels wide, wider for a sweep
with many columns. An image too heavy for one browser reply (about 3 MB of
PNG) is written top to bottom as `<name>-1-of-<n>.png` and on, each file one
screenshot. Looking at every cell catches what no number does: the unplanned
figure, the mirrored pair, the cell nearest the bad drawing. The three hand
drawings from [looks to leave out](#ask-which-looks-to-leave-out) are the
sheet's yardstick: one line per seed says which drawing it resembles and what
it lacks.

**A film is judged on its looks first.** Before writing a script that measures
a film's picture or sound, draw the strips the library already has;
`npm run film` names each one not drawn
([before you export a film](film-route.md#before-you-export-a-film)).

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9 --sound --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --contacts cues.contacts --loupe --sound --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 1.5,4 --loupe --png
```

The first lays the soundtrack under nine frames, the second shows each planned
contact with the frames around it, a 100% crop at export size and its sound,
and the third 100% crops at chosen seconds. A film-scaffold piece keeps its
contacts in `cues.contacts`; another piece names its own list, a piece that
plans no contact skips that strip (an empty list is refused), and a silent
piece leaves out `--sound`. `--json` gives the same as numbers:
`sound.profile.events` lists each event's `seconds`, `sound.silences` each
silent stretch, and `sound.gaps` a scaffold piece's bed and ambience levels.
A script of your own is for what none of them shows.

For a film, [look at a film](films.md#look-at-a-film) at its cuts
and transitions. In a stylised piece, the sheet at 100% shows rocks, water and
plants keeping near-real proportion while built things and figures take the
caricature, colour changing within a form for a cause, foliage mixing ages,
and iridescence staying within each element's own hue range
([believable nature](materials.md#check-nature-and-iridescence-at-100)).
A time strip names each frame that goes nearly empty and each run held still
for 6 s or more (`window.__sheet.flags`, `empty` and `holds`), and judges each
run's light in `flags.lights`; each flag is a fact about the film, kept when
the film means it. A time strip draws the piece's own seed; `--seed <n>` draws
it at another. `--sound` on a time strip of a piece that declares sound draws
the soundtrack you cannot hear: each sound's start against the frame that
shows its cause, loud moments against quiet ones, and any band of noise over
the whole film. It shades each silent stretch, 0.5 s or more under -60 dBFS,
at the start, between sounds or at the end. For a film-scaffold piece it also
reports each shot's bed and ambience gaps under the events and flags a shot
short of the guide.

**Nine seeds show what the piece can do; a hundred show what it usually
does.** A hundred-seed count finds two things nine cells hide: variation that
lives only in detail nobody sees, and a kind that always leads when the piece
never meant it. `solve` the piece at seeds 1 to 100 in Node (load it with
`loadExternal` from `tools/piece-input.js`), compute two measures from its
state that matter to it, such as a count, a spread or where the focus lands,
and draw the seeds at the densest bin and at both extremes with
`npm --prefix "<library root>" run still -- "./my-piece.cjs" --seed <n>`.
One line per seed in visual terms: two lines that differ only in amounts are
one picture. On the seed sheet's PNG with each cell about 64 pixels wide,
seeds that no longer differ say the variation lives in detail; a seed that
moves the silhouette and the largest masses first still reads at that size.
A generator states its data structure whether the painter chose the statement
or not: over the same hundred seeds, what the seed decides about who or what
the piece shows (which kinds are paired, which one leads, which is lit and
which is large) is what the piece says, and a kind that always leads sits in
the structure, not the seed. The count is for a piece others will re-roll;
a piece whose picture never reads its seed skips it, as it skips the sheet.

**A round of changes has one aim that can be judged.** Look at the result
small first: a change that shows only when the picture is enlarged has not
improved what a viewer sees, whatever it cost. One aim a round, named in
visual terms before the edit, keeps a better or worse answer possible; three
aims changed together leave nobody able to say which one helped. The rounds
end when the picture does what the brief asks, not when the file is tidy or
every number is met: a complete file is not yet a picture that works.

### Depth order and contacts

**A thing in front stays in front.** A planned layer per drawn thing against
each character, with all of the thing painted on that layer, is what keeps it
there. A part whose layer comes from a screen-space test on the frame, such as
which side of the character its tip falls, passes behind the character on one
side and in front on the other: a tuft sorted that way swaps sides as the
character crosses it. A painter's sort by depth in the scene, such as a sort
of isometric boxes, is a planned order and may run on every frame (a sort that
also orders boxes that overlap on screen lets an overlap starting or ending
change which box is in front without their centres crossing, and a cycle of
boxes each in front of the next must be broken at one box); a piece with no
sort draws its parts back to front by hand. Each change of side that a depth sort makes is a
planned event, and `layerSwaps` (below) reports it on that frame. A sort that
paints one thing's marks between another's on one frame makes it report
`mixed`; split by depth, every pair holds one side. Any other layer change is
an event planned in the cue table. In the [film scaffold](../film-scaffold.cjs) a
row's place in the table is its layer (its `depth` is parallax, not paint
order), so a thing that changes layer ends its row on that frame and a second
row of the same name enters at its new place on that same frame (the scaffold
refuses two rows of one name when a frame shows both). Each row's `life`
starts again from 0, so a move that crosses the change is timed from
`clock.frame`, or by a span over the whole stay, or it jumps on that frame;
one that scales with THE TEMPO gives both rows the same `keys` track read at
`clock.frame`, since keys sit on film frames and THE TEMPO retimes them.

A planned contact is listed in the plan with a reaction in the thing touched
(it bends, gives, cracks or rings) and a sound of its own, mixed
[under the scene](sound.md#voices-a-place-and-a-room) unless the touch is its focus.
A soft or lasting touch, such as a foot into grass or a hand along a rail,
starts on the first frame the two outlines meet, which can be frames before a
landing: that frame comes out of `build` from the positions `draw` uses, and
the reaction and the sound start on it. A reaction held at its deepest until
the contact ends, and let go from that full extent, reads at film speed; one
that follows the overlap instead peaks and eases off while the outlines still
meet, so it is let go from a shallower bend and springs back too little to
see. A hard hit keeps [its own timing](films.md#takes-and-accents).
The planned contacts kept as a list in the state, each with its `frame` (or
`seconds`) and, where it has one, its design point `x`, `y`, are what the
contact strip draws; a simulation's `contacts` log already has that shape.

The contact strip,
`npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --contacts cues.contacts --loupe --sound`,
shows two frames before to three after each contact, each contact starting a
row of its own, with a 100% crop around each contact's point (a contact with
no point gets the centre of the frame, which misses a foot). It finds a part
that cuts through another or changes layer, and shows the reaction on the
contact frame and the frames after it ends; a list on more than 24 frames,
such as a whole impact log, is refused, so the planned contacts stay apart
from the log. `layerSwaps(piece, solved, frames, things)` from
`tools/contact-sheet.js`, with `things` naming each thing by a test of a mark
(its style, width or root), returns every frame on which one thing is painted
in front of another in some places and behind it in others, or changes side
between frames; around every contact, a report that is not a planned change,
a depth sort's change of side (for a sort that orders overlapping boxes, also
one from an overlap starting or ending) or a layer event in the cue table is a swap nobody
planned. Both are for a film with planned contacts; one whose things never
overlap skips them. See [paint order](../../../docs/knowledge/command-line-tools.md#paint-order).

**Two moving things that overlap on screen either touch or pass apart.** An
overlap nobody planned reads as a collision nothing answers. Wherever two
moving outlines meet, painters choose one of two things: a planned contact,
with its reaction and sound as above, or a depth cue held from the first frame
of the overlap to the last, the far one smaller, hazier or paler, and one of
the two in front the whole time. The time strip and the seed sheets show the
frames where two moving outlines meet; each is on the contact list, or has
its held depth cue, or is that collision.

**A part meets its body, at rest as much as in motion.** A part joined at a
seam, a hinge or a stem rides its body's transform, so it takes every move,
turn and squash the body takes, as
[everything is joined to something](films.md#what-every-scene-holds) and
[a face on an object](faces.md#a-face-on-an-object) say. One transform still
leaves a gap when the part's ends are offsets picked by eye: they stop short
of the body's outline on every frame, and a few pixels of background between them
reads as a loose piece. Ends taken from the function that draws the body's
outline, at the points where the two meet, and run a stroke width into the
body, with the part painted on the layer behind or in front, make the joint an
overlap at any size or squash. A gap that small hides at sheet size; a 100%
crop on the joint (`--at` with `--loupe x,y`, in
[time strips](../../../docs/knowledge/command-line-tools.md#time-strips)), at
rest and on the frame of the deepest squash or turn, shows it.

### Vary with intention

- **Decide what the seed owns.** Authored layers, such as the focal placement,
  the horizon, the largest masses and the key light, stay put; the seed moves
  the rest.
- **Connect the decisions.** A seeded choice with at least two readers, such
  as a palette choice that also sets mark density, multiplies the variation;
  independent choices add up, and three of three read as six, not nine.
- **Give the causes a hierarchy**: a seeded plan, groups inside it, then
  marks, each a named `build` stage. The plan drawn alone as flat shapes shows
  whether it holds.
- **Place in sites.** Independent uniform positions clump by chance; sites
  chosen and filled, with the empty space between them planned, do not.
- **Count a seeded cluster odd.** A group of like things around one place,
  such as stones, windows, clouds or marks around a focus, keeps a centre at
  three, five or seven; an even group splits into mirrored pairs and the eye
  halves it. A planned cluster's count drawn from the odd values in its range
  keeps that centre at every seed, and one that comes out even is a rule
  broken on purpose. Over 100 seeds, the count of even clusters in the state
  says how often the rule broke; on the seed sheet, a cluster split into
  mirrored pairs shows where.
- **Reject and retry by address, never by stream.** Try layouts
  `R('layout', 'try', k)` for `k = 0, 1, 2...`, keep the first that passes a
  named test, keep `k` in the state, and over a hundred seeds report how often
  `k > 0`. Pruning what fails is easier than forcing one algorithm to vary.
- **Space seeded events by gaps, not chances.** A gap drawn from a
  distribution with a clear mode, `R('blink', 'gap', i)`, spaces events; a
  chance per frame clumps and starves. When the seed or a simulation decides
  events across a film, an intensity per frame measured from the solved state
  in `build` and compared with the
  [planned intensity](films.md#plan-intensity-with-the-story) lets
  each stretch's gaps follow how far the stretch before it ran above or below
  the plan, so every seed keeps a build-up, a peak and a rest. Over 100 seeds,
  a quieter stretch after each peak, with the highest in the planned peak
  beat, says the plan held.
- **A performer misses the beat a little.** A deliberate action of a figure
  that plays or performs, offset from its authored beat by a lean drawn per
  player and phrase, such as `R('knock', 'lean', phrase)`, plus a smaller
  spread per note, such as `R('knock', 'late', i)`, reads as played (a
  [lean that eases between phrases](music.md#swing)): about 1 to 1.5 frames at
  24 fps for a practised performer, wider when it is rushed or clumsy, none
  for a machine. A deliberate action repeated faster than about 8 a second
  (3 frames apart at 24 fps) reads as a machine too.
  The cause itself moves, so its sound still starts on the frame that shows
  it. Given the authored beats rather than the actual contacts, a
  `--contacts` strip with `--sound` puts each beat in its row's third cell:
  actions within about two cells of it, and not on it in every row, show the
  offset; every action on the beat cell shows none.
- **Give a sign an answer, or draw it as ornament.** A seeded glyph,
  inscription or cryptic mark that nothing else answers sends the viewer
  hunting; one who learns the signs lead nowhere stops looking. Painters give
  a sign its answer, or draw every mark of that kind plainly, as pattern. A
  [fresh-eyes reviewer](films.md#fresh-eyes-review) asked what each
  sign meant, who hunted for a meaning and found none, has found the
  unanswered one.
- **Commit a region change late, then blend.** A palette, sound bed or theme
  that follows the region a mover is in flickers when it changes at each
  crossing of the line and the mover wavers on it; committed only once the
  mover is well past the boundary, then blended over seconds, it holds, and a
  mover that wavers keeps the old state. The committed region solved per
  frame in `build` and kept in the state keeps the change
  [a function of the state](sound.md). At a seed whose mover crosses a boundary
  back and forth, a `--frames` strip and a `--sound` strip show one change per
  committed crossing.
- **Break a rule on purpose, rarely.** One seed in about ten may break a
  named rule of the piece, named at the top of the source; more often, it is
  the rule.

## Ask which looks to leave out

A list of looks to leave out, kept in the comment at the top of the source,
is what the seed review judges a frame against; without one, Canvas2D's
defaults pass as choices. The defaults in
[stills](stills.md#looks-to-leave-out) and
[films](films.md#looks-to-leave-out) start the list. When the brief
does not say, the painter chooses the list and names it under
`Chosen, not given:` ([find the idea](#find-the-idea)); a brief that names
its looks is the list. A grain
pass over the finished frame is on a still's list and not a film's: a film's
finish is one declared process over every frame.

Three outputs drawn by hand before the generator, as fixed drawings with no
seed (an ordinary one, a rare and striking one, and a bad one), give the
[seed review](#look-at-nine-seeds) a yardstick for each seed; reference
frames a brief brings stand for the first two, never the bad one. Canvas2D's own
defaults (one stroke width, round caps, flat fills) are a look too, and belong
on the list unless the piece chose them.

The list belongs to the piece; the library forbids no style.

**A line that defines a form carries weight with structure.** A weighted line
swells where the gesture presses and toward the middle of a long arc, tapers
at the ends, scales its width with the form's size on screen and runs heavier
on the nearer part of the form; silhouette, inner edges and texture each keep
their own line quality, and a dark of the local colour or a dark grey holds a
shape where black would cut it out. Artists keep a constant pen instead when
the style is one, such as a plotter line. In a film, a line that changes
between frames without being declared reads as a boil nobody meant; the
deliberate boil is declared, as [Line weight](stills.md#line-weight)
explains with the reasons. `outline` from `core/path.js` draws the line.

## Read an example before you write a piece

**Open the one whose idiom is closest to what you are making, and none of them
is the starter.** They exist because they break each other's assumptions, and
the notes at the top of each say what it is in the set to prove.

| `examples/` | idiom | time | declares |
|---|---|---|---|
| `drift.js` | organic, painterly — ribbon washes, opacity, a flow field | 240 frames | **raster only** |
| `specimen.js` | hard-edged, typographic — a stroke font, straight runs | a still | raster + vector |
| `readout.js` | data-driven — a fixed dataset the seed may not touch; it sounds, the data choosing the pitch; picture and sound share one shot list | 168 frames | raster + vector + sound |
| `cues.js` | authored motion — eased moves, bumps and a blink, and scene changes blended part by part, all written as one cue table on whole frames; each part is heard as it turns, and the motion as it lands, hops, blinks, rocks and settles; one film finish over all four palettes | 192 frames | raster + vector + sound + finish |
| `partition.js` | recursive subdivision — area, not marks | a still | raster + vector |
| `contours.js` | plotter-native — one pen, one weight, no fills | a still | raster + vector |
| `packing.js` | closed forms grown until they touch — composition decided by refusal | a still | raster + vector |
| `pattern.js` | one motif repeated by a wallpaper group — the structure is a group | a still | raster + vector |
| `lsystem.js` | a grammar and a turtle — it computes a word, not coordinates | a still | raster + vector |
| `attractor.js` | a chaotic orbit printed as a density — arithmetic only | a still | **raster only** |
| `inversion.js` | three circle mirrors — closed-form reflections and a bounded depth-first word tree | a still | raster + vector |
| `cover.js` | a front cover — the type is set first, the picture grows around it | a still | raster + vector |
| `settle.js` | forces finding their own arrangement — state that evolves, still scrubbable, plucked once the collapse has thinned so it moves to its last frame; every sound an event the picture shows: an edge snapping taut, two discs knocking, a pluck, each on its frame and where it stands | 144 frames | raster + vector + sound |
| `pixel-field.js` | seeded pixel noise, domain warp and advection; explicit optional WGSL preview | 240 frames | **raster only** |
| `refit.js` | responsive — a container whose contents refit to the box it is drawn at: a box no roomier and no taller than the default holds fewer of the same things at their size, and a roomier or taller one, even a narrow tall one, holds them bigger; what the walls squeeze over the rim goes only while it touches the pile or a wall; its film moves along a box timeline, wide to portrait to square | 240 frames | raster + vector, **boxes**, **reframe** |
| `automaton.js` | a one-dimensional cellular automaton — a Wolfram rule number as an integer knob, every generation stacked, each run of live cells one strand coloured by its birth and its length | a still | raster + vector |
| `growth.js` | a two-dimensional cellular automaton — a Life-like rule solved whole in the build, fronts that grow and erode, each cell keeping the colour of the generation it was born in | 240 frames | raster + vector |
| `cascade.js` | bodies that touch — discs let go one by one down tuned ledges, through a hanging thread and into a basin, solved by `core/sim.js` in the build; the contact log is the score, each impact a ring, a note and a glow on the ledge struck, on its frame | 216 frames | raster + vector + sound |
| `stride.js` | a figure hinged on purpose, as a puppet or a machine is, walking (a person or an animal is painted as one outline that bends, with `core/deform.js`) — hips, feet and arms posed by `keys` over one `gait`'s phase, planted feet turning about heel and toe without sliding, knees solved from hip and ankle; each contact is a footfall on its frame, the camera following through a landscape at several depths | 192 frames | **raster only** + sound + finish |
| `drape.js` | a still made by a simulation — cords hung between nails fall across pegs, and only where they came to rest is drawn | a still | raster + vector |

Subject-specific algorithms stay with their examples; core helpers must remain
useful across subjects. Marching squares and flow walks live in `core/field.js`,
used by `contours` and `drift`. The shared stroke font lives in
`core/stroke-font.js`. It exports `ascent`, `descent` and `leading` in cap
heights; `text()` draws one line, so a piece that stacks lines spaces them at
least `size * font.leading` apart, or a comma reads as an accent on the line below;
`examples/stroke-font.js` remains a compatibility entry point exporting the
same module. Segment chaining stays in `core/geom.js` and
is used by `core/field.js` to join isoline segments.

### Text in the frame

The stroke font has capitals, lower case, figures, some punctuation and the
Spanish letters and marks (`á é í ó ú ü ñ`, their capitals, `¿` and `¡`), each
on one advance with no kerning. A mark over a capital reaches up to 0.2 of the
cap height (`size`) above the cap line, into `font.leading`, which does not
grow for it. Lines stacked at `font.leading` then allow one clash: a `g` or
`¿` of the line above set directly over an accented capital touches its acute
at any line width over 0.03 of the cap height, and `¡` or `j` does at the
heaviest widths (over 0.072 and 0.088), so stack lines further apart or move
the words. Keep the
line width under 0.09 of the cap height when a string has accented
capitals, or the mark joins its letter. Marks over lower case stay apart up
to 0.14 of the cap height. Any other character, such as `+`, `%`, `=`,
`°` or `à`, draws as a gap. `font.missing(str)` names
the characters of a string that the font lacks; with a missing character,
painters draw that mark themselves or choose another word. How long words
hold on screen, and how they arrive and leave in a film, is in
[words in motion](films.md#words-in-motion).

When a frame holds a title or a label:

- **Break a title where its phrase breaks.** A break inside a phrase leaves a
  short last line that reads as a second title.
- **Make the title about three times the label's cap height.** At cap heights of 34
  and 11 the title leads; at 15 and 12 the two read as one caption.
- **Keep text 10% inside every edge**, as the
  [focal composition](stills.md#art-direction-preset-focal-composition)
  describes. Closer, the title crowds the corner.
- **Set text on a quiet area, in a value far from the ground's.** The letters
  are lines, so over grass, hatching or rain the ground's lines join them. A
  label in a mid value over a mid-value sky disappears first.
- **Give the stroke more than 1 pixel in the exported film.** Whether a light
  stroke on a dark ground reads depends on its width in exported pixels, not on
  its share of the cap height. At 1 pixel it greys at every cap height, because
  the line falls across two rows of pixels; at 1.6 pixels it holds, and at 2 it
  reads clean, even 2 pixels on a cap height of 68. The default film draws each
  design unit as 1920 divided by the piece's long edge in design units, and
  never fewer than 1 pixel. The width also has a ceiling: at about a fifth of the
  cap height, the strokes close the counters of A, R and E.
- **In a film, hold any text fully drawn long enough to read it aloud
  slowly.** This covers titles, labels and captions, not only data. `--at`
  shows the hold as [data images](data-images.md#it-reads-alone)
  describe: from the frame its last stroke arrives to the last frame it
  stays, with no cut or beat between.
- **Put a label beside what it names.** In a corner, it reads as a credit.
- **A glow has a light that casts it.** A glow with no light in the scene to
  cast it blurs the stroke's edge into a stock neon look; painters give the
  glow a visible source, or set the letters sharp.

How words arrive, act, change and leave in a film, and how captions read
muted, is in [words in motion](films.md#words-in-motion).
