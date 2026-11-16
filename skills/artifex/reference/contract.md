---
type: knowledge
summary: "The Artifex piece contract past its field list: the normalised playhead and the clock, authored motion, build stages, declared parameters, boxes and reframing, and the WebGPU preview; read with the core skill when writing a piece's fields."
related_files: ["skills/artifex/SKILL.md", "core/piece.js", "core/time.js", "docs/apis/piece-api.md"]
---

# The contract

**`t` is normalised and quantised**: always in `[0, 1]`, always on the drawn-frame
grid, never seconds and never a frame number. The fourth argument is where those
live:

```js
draw(g, s, t, clock) {
  clock.frame      // which drawn frame this is, 0 .. frames-1
  clock.frames     // how many there are
  clock.seconds    // where that frame sits in the piece's own time
  clock.hz         // and the rate it was declared at
  clock.loop       // whether t=1 is t=0 again
}
```

Use `clock.frame` for fixed-step lookups and `clock.hz` for the declared rate. Do
not duplicate `duration` and `hz` as separate constants to recover a frame index.

**Author motion with `core/time.js`**, not with hand-written clamps and curves:

```js
const { ease, tween, shots, shotAt } = require('artifex/core/time.js');
const { lerp } = require('artifex/core/num.js');
const SCORE = [['open', 2], ['close', 4]];   // fills a six-second timeline
const lift = tween(0.5, 1.3, ease.out);      // a move, timed in seconds

draw(g, s, t, clock) {
  const shot = shotAt(shots(SCORE, clock), clock.frame);   // integers, not seconds
  const y = lerp(400, 120, lift(clock.seconds));
}
```

- **Cut on whole frames.** A cut summed in seconds can land a float either side
  of a frame: `0.1 + 0.2` is not `0.3`. `shots` puts each cut on its nearest
  frame once, and `shotAt` compares integers. Resolve the same list in `sound`
  with its `timeline`, and the soundtrack cuts on the frame the picture does.
- **A zero-length `span` is a cut**, 0 before its instant and 1 from it on.
  `unlerp` answers 0 there, which for time is a change that never happens.
- **A `span` window finishes only if it closes by the last frame's playhead**,
  `1` when the timeline does not loop and `(n - 1) / n` when it loops, with `n`
  from `clock.frames`; close it by then, as drift does with
  `span(st.birth, Math.min(st.birth + st.span, 1), t)`, or count in frames and
  close it by `clock.frames - 1`.
- **`ease` curves hold their end values outside `[0, 1]`**, exactly. `back`
  passes its mark and settles; `bump` goes out and comes back, an event such as
  a blink. The table is frozen because every piece in a page shares it.
- **A cut is a hard cut.** The module has no transitions; a film authors them
  as cues ([continuity](films.md#continuity)).
- **`spring` and `follow` move with weight.** `spring({ stiffness, damping,
  delay })(s)` takes seconds since a cue and rises from 0 to 1: `damping` is a
  ratio, below 1 it passes the mark and rings, 1 arrives soonest without
  passing it, above 1 it creeps in. Its `settle` is when it stays within 0.1%.
  `follow(driver, opts)(s)` is a part hung behind any driver of the same
  seconds: it trails, passes the driver when it stops, and settles. Use them
  instead of hand-written recoil arrays and decays.
- **`keys` and `gait` pose figures.** `keys([[at, value, rate], ...])(x)`
  strings key poses, breakdowns and holds on one line, each key's rate shaping
  the move to the next. `gait(start, lengths)(x)` counts steps, its fraction
  the phase, and its `contacts` place the footfalls. For a person or creature
  read [plan poses before motion](films.md#plan-poses-before-motion)
  (painted over a [hidden mannequin](films.md#paint-over-a-hidden-mannequin));
  read [hinged figures](films.md#hinged-figures) only for machines,
  puppets, cut-outs and styles that show their joints.
- **`keyOutline` steps through key outlines.** `keyOutline(keys, v)` returns
  the outline at track value `v` from keys traced with the same points: the
  floor picks the pair, the fraction blends it. Per-point `weights` over
  several track values give each point its own value, for succession.
  `keyFaults(keys, { ratio })` lists outlines that cross themselves and spans
  that stretch past `ratio` between keys; run it in a test
  ([paint over a hidden mannequin](films.md#paint-over-a-hidden-mannequin)).
- **`pose`, `reach` and `project` give any jointed thing depth.** `pose` chains
  segments in 3D, each joint a twist then a bend; `reach`'s `bendDir` puts a
  two-segment solve's middle joint on its side, such as a body's forward for a
  knee and its back for an elbow, instead of sideways. `project` returns each segment's picture ends, its
  foreshortening and a section ellipse at each end with the rim half nearer the
  viewer, so strokes know which way a surface turns; its `centre` sets where
  weak perspective scales and where depth starts (default the world origin), so
  pass the figure's middle to pose in canvas coordinates; `perspective: 'joint'`
  divides each joint by its own depth, so a part aimed at the camera widens at
  its near end, and each segment's `scale` [start, end] goes into its widths
  ([depth armature](../../../docs/apis/piece-api.md#depth-armature)).
  `crossContours(seg, R, name)` in `path.js` lays seeded arcs over each
  section's visible half (within a tilt of 0.2 of end-on, they can reach the
  far half), from the shade side thinning toward the light, ready
  for `outline` ([cross-contours](../../../docs/apis/piece-api.md#cross-contours)).
  Without `eye`, every arc on a straight part is the same ellipse, as an
  orthographic view shows it; `eye: { at, focal }`, the picture point `centre`
  maps to and the `focal` given to `project`, opens each arc by its own
  section's direction from the eye (on an upright part, its height from eye
  level), straight at it and bowing the other way past it. `stop: [low, high]`
  ends each arc where the surface under it reaches a seeded light level between
  the two, and scales a shortened arc's `width` by the share of its span it
  keeps. The cut eases in over 0.2 of full light, so a bend never halves or
  drops an arc in one frame, and an arc can run up to 0.2 past its level.

`examples/cues.js` shows the whole pattern: its build writes every move, bump and
scene change as a cue in frames, and `draw` and `sound` read only that table. A
scene change there blends from its boundary frame, one part after another, and
each part's note sounds on the frame that first shows it turning.
The film scaffold keeps its cues in `s.cues` the same way; its optional
`BLOCKING` rows, each shot's subject marks and line of attention, land in
`s.cues.blocking`, where `seeds --plan` draws them and flags a view on the
wrong side of the line ([continuity](films.md#continuity)). Its
`FOCUS` rows land in `s.cues.focus` for `seeds --cuts`
([cut pairs](films.md#look-at-a-film)).

Read the [piece API](../../../docs/apis/piece-api.md#authored-time) for the contracts.

**Declared parameters arrive as `state.params.<name>`**, already validated
against the range you declared. An unknown or out-of-range one is refused by
name. Each one's `meaning` must say what it does to the picture in at most 120
characters. A knob is continuous: a slider can hand a whole-number one any
value between, so take it with `Math.round` in `build`. Set `min` and `max`
where the picture stops working, not where the code breaks: sweep the range
and pull each end in to the last cell that still reads. A `--param` sweep of
`count` samples spaces them evenly from `min` to `max`. When `min` and `max` are
whole, both within 2^53 (about ±9e15), and `(max - min) * (count - 1)` stays
under 2^53, a sample that falls on a whole value is exactly that value, so for
one whole-number knob `max - min + 1` samples give one cell per whole value. A
two-knob grid uses one count for both axes: when both knobs meet that bound,
pick a count whose `count - 1` divides both spans, and every cell gets whole
values. The sheet labels each cell with its sample rounded for display; the
piece gets the sample itself.

**`loop` decides where the frames sit.** For n > 1, a looping piece has n frames
at `i/n` and `t=1` is `t=0` again, so it can repeat seamlessly. A piece that does
not loop has n frames at `i/(n-1)` and its last frame is the completed one, so a
reveal finishes. A one-frame timeline has the single playhead 0. Use the shared
frame helpers for drawing and export so they agree on the frame grid.

The **design box never changes** unless the piece declares `boxes`. Aspect
ratio, device scale and output medium are render-time choices — that is the
whole reason one piece serves four outputs.

**A piece that should recompose to its box declares `boxes`**: the ranges of
width and height, in design units, it can lay itself out in. `size` must lie
in them and is the box used when nobody chooses one. `atBox(piece, { w, h })`
returns the piece at another box, refusing one outside the ranges by name.
Build stages and `draw` read the box they were solved for from `state.box`,
and decide the composition from it: keep marks at their size in design units
and change how many fit, rather than scaling everything. Address each element
by its index, so the same elements appear at every box and only their
arrangement changes. The recipe records the box as `size`, and replay draws the
file again at it. `examples/refit.js` shows the whole pattern, and bounds
the cost of a box roomier or taller than its default by scaling its things
up there, by one factor that is never below one and changes with the box
without a jump, so that a box with four times the room holds fewer, bigger
things rather than four times as many. The page shows
width and height sliders for such a piece; its **live player**
(`index.html?player=1`, linked beside the playhead) shows the piece alone,
takes the window's box and recomposes as the window changes, without stopping.
A film's frame size cannot change while it plays, but its box can: declare
`reframe: [{ t, w, h }, ...]`, boxes at strictly increasing playheads, with
`size` the largest (max w by max h), which stays the frame. Either lay out
once per box from `state.reframe` and, in `draw`, move each element from its
place in layout `clock.box.from` to its place in `clock.box.to` by
`clock.box.u`, or, as `examples/refit.js` does, solve the piece frame by frame
along the list in a build stage, the box of each frame read from
`state.reframe`, so that a box change only rearranges what is there: never a
cut, and nothing emptied or laid out again. `clock.box` gives `{ w, h, x, y,
from, to, u }` either way. Replay follows the recipe's `reframe`. The live
player plays a timeline fitted whole instead of taking the window's box. Try
another timeline, written `t:WxH,t:WxH,...`, with the page's
`&reframe=0:1280x720,1:405x720` or `--reframe` on `npm run film` and
`npm run seeds`; `atBox` refuses by name one the piece cannot play.

**Each box is a new composition, not a crop.** Before you lay out a box,
decide what it must keep: whether what matters lies across the width or down
the height, and keep that whole at every box. Crop unevenly when one side
holds where the subject is heading. What a box adds says something: more of
the subject makes it the force, more of its surroundings makes the world the
force. Name what each added area means, or give it nothing that pulls the
eye. A subject left at its size in a much roomier box loses rank, so let it
grow there, or recompose around a telling detail, and keep its share of the
frame and its contrast first at every box; `examples/refit.js` scales its
things up in a roomier box. Keep what sets the action going at the same place
relative to the box, and when the box changes, anchor each element's move on
the point the action flows from. Each shape has its strengths: wide for space,
long horizons and numbers; tall for hierarchy, height and falls; square for
weight, sturdiness and the uncanny. Work against a shape when the beat needs
it: tall forms over tiny ones give height in a wide box, and dark masses at
its sides narrow it. Draw a contact sheet at each declared box with `--box`
and check that every cell reads as composed for its shape. A `reframe`
timeline changes the box with the feeling, narrowing over a beat that
confines and opening on the release, and holds it still around each change;
see [films](films.md#camera-and-framing).

For a costly opaque per-pixel field, an author may add
`preview: { kind: 'webgpu-pixels', wgsl, uniforms }` to a raster-only piece.
Read the [WebGPU preview](webgpu.md) first: `draw` stays the CPU
implementation, and exports, contact sheets and replay stay on the CPU.
